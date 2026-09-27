import { pairKey } from "./graph";
import { LineageWarning, PersonId, PersonInfo, Tree } from "./types";

/** Vertical metrics, in px. Horizontal sizes come from the measure callback. */
export const METRICS = {
	nameSize: 13,
	yearsSize: 11,
	/** Baseline offsets from the node's top. */
	nameBaseline: 13,
	yearsBaseline: 29,
	/** Vertical middle of the name line, where marriage lines attach. */
	nameMid: 8.5,
	nodeHeight: 33,
	nodeHeightNoYears: 17,
	genGap: 64,
	coupleGap: 36,
	siblingGap: 24,
	familyGap: 44,
	margin: 24,
	trackStep: 6,
};

export type Point = [number, number];
export type Polyline = Point[];

export interface LayoutNode {
	id: PersonId;
	info: PersonInfo;
	years: string;
	/** Centre x. */
	x: number;
	/** Top y. */
	y: number;
	width: number;
	gen: number;
}

export interface Layout {
	nodes: LayoutNode[];
	marriageLines: Polyline[];
	descentLines: Polyline[];
	width: number;
	height: number;
	warnings: LineageWarning[];
}

export type Measure = (text: string, kind: "name" | "years") => number;

interface Union {
	key: string;
	partners: PersonId[];
	children: PersonId[];
}

interface Block {
	members: PersonId[];
	gen: number;
	/** Left edge of each member relative to the block's left edge. */
	offsets: number[];
	width: number;
	left: number;
}

export function formatYears(born: number | null, died: number | null): string {
	if (born !== null && died !== null) return `${born} – ${died}`;
	if (born !== null) return `b. ${born}`;
	if (died !== null) return `d. ${died}`;
	return "";
}

export function comparePersons(a: PersonInfo, b: PersonInfo): number {
	const ab = a.born ?? Infinity;
	const bb = b.born ?? Infinity;
	if (ab !== bb) return ab < bb ? -1 : 1;
	return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export function layoutTree(tree: Tree, measure: Measure): Layout {
	const M = METRICS;
	const warnings: LineageWarning[] = [];
	const info = (id: PersonId) => tree.persons.get(id) as PersonInfo;
	const ids = Array.from(tree.persons.keys()).sort((a, b) => comparePersons(info(a), info(b)));

	const parentsOf = new Map<PersonId, PersonId[]>();
	const childrenOf = new Map<PersonId, PersonId[]>();
	for (const id of ids) {
		parentsOf.set(id, []);
		childrenOf.set(id, []);
	}
	for (const [p, c] of tree.parentEdges) {
		(parentsOf.get(c) as PersonId[]).push(p);
		(childrenOf.get(p) as PersonId[]).push(c);
	}

	// ---- Unions: declared marriages plus every pair of co-parents. ----
	const unions = new Map<string, Union>();
	const unionOf = (partners: PersonId[]): Union => {
		const key = partners.length === 2 ? pairKey(partners[0], partners[1]) : `solo\u0000${partners[0]}`;
		let u = unions.get(key);
		if (!u) {
			u = { key, partners: partners.slice().sort(), children: [] };
			unions.set(key, u);
		}
		return u;
	};
	for (const [a, b] of tree.spousePairs) unionOf([a, b]);
	const parentUnion = new Map<PersonId, Union>();
	for (const id of ids) {
		const ps = parentsOf.get(id) as PersonId[];
		if (!ps.length) continue;
		const u = unionOf(ps.slice(0, 2));
		u.children.push(id);
		parentUnion.set(id, u);
	}
	for (const u of unions.values()) u.children.sort((a, b) => comparePersons(info(a), info(b)));
	const unionsOfPerson = new Map<PersonId, Union[]>();
	for (const u of unions.values()) {
		for (const p of u.partners) {
			if (!unionsOfPerson.has(p)) unionsOfPerson.set(p, []);
			(unionsOfPerson.get(p) as Union[]).push(u);
		}
	}

	// ---- Generations. Partners share a generation unless that is impossible. ----
	const gen = assignGenerations(ids, info, childrenOf, unions, warnings);
	const maxGen = Math.max(0, ...Array.from(gen.values()));

	// ---- Blocks: partners in the same generation are kept side by side. ----
	const layers: Block[][] = [];
	for (let g = 0; g <= maxGen; g++) layers.push([]);
	const blockOf = new Map<PersonId, Block>();
	{
		const adj = new Map<PersonId, PersonId[]>();
		for (const u of unions.values()) {
			if (u.partners.length !== 2) continue;
			const [a, b] = u.partners;
			if (gen.get(a) !== gen.get(b)) continue;
			if (!adj.has(a)) adj.set(a, []);
			if (!adj.has(b)) adj.set(b, []);
			(adj.get(a) as PersonId[]).push(b);
			(adj.get(b) as PersonId[]).push(a);
		}
		for (const id of ids) {
			if (blockOf.has(id)) continue;
			const comp: PersonId[] = [];
			const stack = [id];
			const seen = new Set([id]);
			while (stack.length) {
				const cur = stack.pop() as PersonId;
				comp.push(cur);
				for (const n of adj.get(cur) ?? []) {
					if (!seen.has(n)) {
						seen.add(n);
						stack.push(n);
					}
				}
			}
			const members = linearise(comp, adj, info);
			const block: Block = { members, gen: gen.get(id) as number, offsets: [], width: 0, left: 0 };
			for (const m of members) blockOf.set(m, block);
			layers[block.gen].push(block);
		}
	}

	// ---- Ordering: barycentre sweeps. ----
	const norm = new Map<PersonId, number>();
	const renumber = (g: number) => {
		const members = layers[g].flatMap((b) => b.members);
		members.forEach((m, i) => norm.set(m, (i + 0.5) / members.length));
	};
	for (let g = 0; g <= maxGen; g++) renumber(g);
	const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
	const blockNorm = (b: Block) => mean(b.members.map((m) => norm.get(m) as number));

	const unionNorm = (u: Union) => mean(u.partners.map((p) => norm.get(p) as number));

	// Downwards: full siblings stay together as a group, groups ordered by the
	// position of their parents' union. A block holding children of two unions
	// (an intermarriage) joins one group and sits at the edge facing the other.
	const sweepDown = (g: number) => {
		const inLayer = (u: Union) => u.children.filter((c) => gen.get(c) === g).length;
		const keyed = layers[g].map((b, i) => {
			const us: { u: Union; m: PersonId }[] = [];
			for (const m of b.members) {
				const u = parentUnion.get(m);
				if (u) us.push({ u, m });
			}
			if (!us.length) return { b, i, bary: blockNorm(b), group: "", edge: 0, tie: null as PersonInfo | null };
			us.sort((x, y) => inLayer(y.u) - inLayer(x.u) || unionNorm(x.u) - unionNorm(y.u));
			const primary = us[0];
			const others = us.slice(1).filter((o) => o.u !== primary.u);
			const edge = others.length ? (mean(others.map((o) => unionNorm(o.u))) > unionNorm(primary.u) ? 1 : -1) : 0;
			return { b, i, bary: unionNorm(primary.u), group: primary.u.key, edge, tie: info(primary.m) };
		});
		keyed.sort((x, y) => {
			if (Math.abs(x.bary - y.bary) > 1e-9) return x.bary - y.bary;
			if (x.group !== y.group) return x.group < y.group ? -1 : 1;
			if (x.edge !== y.edge) return x.edge - y.edge;
			if (x.tie && y.tie) return comparePersons(x.tie, y.tie);
			return x.i - y.i;
		});
		layers[g] = keyed.map((k) => k.b);
		renumber(g);
	};
	// Upwards: plain barycentre of each block's children.
	const sweepUp = (g: number) => {
		const keyed = layers[g].map((b, i) => {
			const vals: number[] = [];
			for (const m of b.members) {
				const kids = childrenOf.get(m) as PersonId[];
				if (kids.length) vals.push(mean(kids.map((c) => norm.get(c) as number)));
			}
			return { b, i, bary: vals.length ? mean(vals) : blockNorm(b) };
		});
		keyed.sort((x, y) => (Math.abs(x.bary - y.bary) > 1e-9 ? x.bary - y.bary : x.i - y.i));
		layers[g] = keyed.map((k) => k.b);
		renumber(g);
	};
	for (let iter = 0; iter < 6; iter++) {
		for (let g = 1; g <= maxGen; g++) sweepDown(g);
		for (let g = maxGen - 1; g >= 0; g--) sweepUp(g);
	}
	for (let g = 1; g <= maxGen; g++) sweepDown(g);

	// Flip couples so each partner sits on the side of their own parents, and
	// someone who married in sits on the outside rather than among the siblings.
	for (let g = 0; g <= maxGen; g++) {
		for (const b of layers[g]) {
			if (b.members.length < 2) continue;
			const anchor = (m: PersonId) => {
				const ps = parentsOf.get(m) as PersonId[];
				return ps.length ? mean(ps.map((p) => norm.get(p) as number)) : null;
			};
			const first = anchor(b.members[0]);
			const last = anchor(b.members[b.members.length - 1]);
			const here = blockNorm(b);
			const flip =
				first !== null && last !== null
					? first > last
					: first !== null
						? first > here
						: last !== null && last < here;
			if (flip) {
				b.members.reverse();
				renumber(g);
			}
		}
	}

	// ---- Coordinates. ----
	const width = new Map<PersonId, number>();
	const years = new Map<PersonId, string>();
	for (const id of ids) {
		const p = info(id);
		const y = formatYears(p.born, p.died);
		years.set(id, y);
		width.set(id, Math.max(measure(p.name, "name"), y ? measure(y, "years") : 0, 8));
	}
	const x = new Map<PersonId, number>();
	for (const layer of layers) {
		let cursor = 0;
		layer.forEach((b, i) => {
			let off = 0;
			b.offsets = b.members.map((m) => {
				const o = off;
				off += (width.get(m) as number) + M.coupleGap;
				return o;
			});
			b.width = off - M.coupleGap;
			if (i > 0) cursor += gapBetween(layer[i - 1], b, parentUnion);
			b.left = cursor;
			cursor += b.width;
		});
		layer.forEach(setX);
	}
	function setX(b: Block) {
		b.members.forEach((m, k) => x.set(m, b.left + b.offsets[k] + (width.get(m) as number) / 2));
	}
	const adjacentPartners = (u: Union): [PersonId, PersonId] | null => {
		if (u.partners.length !== 2) return null;
		const [a, b] = u.partners;
		const block = blockOf.get(a) as Block;
		if (block !== blockOf.get(b)) return null;
		const ia = block.members.indexOf(a);
		const ib = block.members.indexOf(b);
		if (Math.abs(ia - ib) !== 1) return null;
		return ia < ib ? [a, b] : [b, a];
	};
	const unionX = (u: Union): number => {
		const adjPair = adjacentPartners(u);
		if (adjPair) {
			const [l, r] = adjPair;
			const le = (x.get(l) as number) + (width.get(l) as number) / 2;
			const re = (x.get(r) as number) - (width.get(r) as number) / 2;
			return (le + re) / 2;
		}
		return mean(u.partners.map((p) => x.get(p) as number));
	};

	const placeLayer = (layer: Block[], desire: (b: Block) => number[]) => {
		const items = layer.map((b) => {
			const ds = desire(b);
			return ds.length ? { desired: mean(ds), weight: ds.length } : { desired: b.left, weight: 0.05 };
		});
		const seps = layer.map((b, i) => (i === 0 ? 0 : gapBetween(layer[i - 1], b, parentUnion)));
		const lefts = isotonicPlace(items, layer.map((b) => b.width), seps);
		layer.forEach((b, i) => {
			b.left = lefts[i];
			setX(b);
		});
	};
	const downPass = () => {
		for (let g = 1; g <= maxGen; g++) {
			placeLayer(layers[g], (b) => {
				const ds: number[] = [];
				b.members.forEach((m, k) => {
					const u = parentUnion.get(m);
					if (!u) return;
					const sibs = u.children
						.filter((c) => gen.get(c) === g)
						.sort((p, q) => (x.get(p) as number) - (x.get(q) as number));
					let total = 0;
					let before = 0;
					sibs.forEach((s, i) => {
						if (i > 0) total += M.siblingGap;
						if (s === m) before = total + (width.get(s) as number) / 2;
						total += width.get(s) as number;
					});
					const centre = unionX(u) + before - total / 2;
					ds.push(centre - (width.get(m) as number) / 2 - b.offsets[k]);
				});
				return ds;
			});
		}
	};
	const upPass = () => {
		for (let g = maxGen - 1; g >= 0; g--) {
			placeLayer(layers[g], (b) => {
				const ds: number[] = [];
				const seen = new Set<Union>();
				for (const m of b.members) {
					for (const u of unionsOfPerson.get(m) ?? []) {
						if (seen.has(u) || !u.children.length) continue;
						seen.add(u);
						const cx = u.children.map((c) => x.get(c) as number);
						const target = (Math.min(...cx) + Math.max(...cx)) / 2;
						ds.push(b.left + target - unionX(u));
					}
				}
				return ds;
			});
		}
	};
	for (let iter = 0; iter < 10; iter++) {
		downPass();
		upPass();
	}

	// ---- Normalise to the margin. ----
	let minX = Infinity;
	let maxX = -Infinity;
	for (const id of ids) {
		const w = (width.get(id) as number) / 2;
		minX = Math.min(minX, (x.get(id) as number) - w);
		maxX = Math.max(maxX, (x.get(id) as number) + w);
	}
	const shift = M.margin - minX;
	for (const id of ids) x.set(id, (x.get(id) as number) + shift);
	const layerTop = (g: number) => M.margin + g * (M.nodeHeight + M.genGap);
	const nodeBottom = (id: PersonId) =>
		layerTop(gen.get(id) as number) + (years.get(id) ? M.nodeHeight : M.nodeHeightNoYears);

	// ---- Connectors. ----
	// Each line remembers its union so crossings between different unions can be bridged.
	const marriageLines: OwnedLine[] = [];
	const descentLines: OwnedLine[] = [];
	const unionPoint = new Map<Union, Point>();
	const bracketTracks = new Map<number, Array<[number, number]>>();

	const sortedUnions = Array.from(unions.values()).sort((a, b) => a.key.localeCompare(b.key));
	for (const u of sortedUnions) {
		if (u.partners.length === 1) {
			const p = u.partners[0];
			unionPoint.set(u, [x.get(p) as number, nodeBottom(p) + 3]);
			continue;
		}
		const adjPair = adjacentPartners(u);
		const [a, b] = u.partners;
		if (adjPair) {
			const [l, r] = adjPair;
			const y = layerTop(gen.get(l) as number) + M.nameMid;
			const x1 = (x.get(l) as number) + (width.get(l) as number) / 2 + 4;
			const x2 = (x.get(r) as number) - (width.get(r) as number) / 2 - 4;
			marriageLines.push({ owner: u.key, line: [
				[x1, y],
				[x2, y],
			] });
			unionPoint.set(u, [(x1 + x2) / 2, y]);
		} else if (gen.get(a) === gen.get(b)) {
			// Partners who are not neighbours: a bracket under both names.
			const g = gen.get(a) as number;
			const [l, r] = (x.get(a) as number) < (x.get(b) as number) ? [a, b] : [b, a];
			const lx = x.get(l) as number;
			const rx = x.get(r) as number;
			const track = claimTrack(bracketTracks, g, lx, rx);
			const y = layerTop(g) + M.nodeHeight + 6 + track * M.trackStep;
			marriageLines.push({ owner: u.key, line: [
				[lx, nodeBottom(l) + 3],
				[lx, y],
				[rx, y],
				[rx, nodeBottom(r) + 3],
			] });
			unionPoint.set(u, [(lx + rx) / 2, y]);
		} else {
			// Partners in different generations (inconsistent data): run a line
			// down from the upper partner and across into the lower one.
			const [up, low] = (gen.get(a) as number) < (gen.get(b) as number) ? [a, b] : [b, a];
			const ux = x.get(up) as number;
			const lx = x.get(low) as number;
			const lw = (width.get(low) as number) / 2 + 4;
			const y = layerTop(gen.get(low) as number) + M.nameMid;
			const endX = ux < lx ? lx - lw : lx + lw;
			marriageLines.push({ owner: u.key, line: [
				[ux, nodeBottom(up) + 3],
				[ux, y],
				[endX, y],
			] });
			unionPoint.set(u, [ux, y]);
		}
	}

	const barTracks = new Map<number, Array<[number, number]>>();
	const bars: { u: Union; g: number; kids: PersonId[]; lo: number; hi: number; track: number }[] = [];
	for (const u of sortedUnions) {
		if (!u.children.length) continue;
		const [ux] = unionPoint.get(u) as Point;
		const byGen = new Map<number, PersonId[]>();
		for (const c of u.children) {
			const g = gen.get(c) as number;
			if (!byGen.has(g)) byGen.set(g, []);
			(byGen.get(g) as PersonId[]).push(c);
		}
		for (const [g, kids] of byGen) {
			const xs = kids.map((c) => x.get(c) as number).concat(ux);
			const lo = Math.min(...xs);
			const hi = Math.max(...xs);
			bars.push({ u, g, kids, lo, hi, track: claimTrack(barTracks, g, lo, hi) });
		}
	}
	for (const bar of bars) {
		const n = (barTracks.get(bar.g) as Array<[number, number]>).length;
		const [ux, uy] = unionPoint.get(bar.u) as Point;
		const barY = layerTop(bar.g) - M.genGap / 2 + (bar.track - (n - 1) / 2) * M.trackStep;
		descentLines.push({ owner: bar.u.key, line: [
			[ux, uy],
			[ux, barY],
		] });
		if (bar.hi - bar.lo > 0.5) {
			descentLines.push({ owner: bar.u.key, line: [
				[bar.lo, barY],
				[bar.hi, barY],
			] });
		}
		for (const c of bar.kids) {
			descentLines.push({ owner: bar.u.key, line: [
				[x.get(c) as number, barY],
				[x.get(c) as number, layerTop(bar.g) - 3],
			] });
		}
	}

	const nodes: LayoutNode[] = ids.map((id) => ({
		id,
		info: info(id),
		years: years.get(id) as string,
		x: x.get(id) as number,
		y: layerTop(gen.get(id) as number),
		width: width.get(id) as number,
		gen: gen.get(id) as number,
	}));

	let bottom = layerTop(maxGen) + M.nodeHeight;
	for (const { line } of marriageLines) for (const [, y] of line) bottom = Math.max(bottom, y);

	return {
		nodes,
		marriageLines: bridgeCrossings(marriageLines, [...marriageLines, ...descentLines]),
		descentLines: bridgeCrossings(descentLines, [...marriageLines, ...descentLines]),
		width: maxX - minX + 2 * M.margin,
		height: bottom + M.margin,
		warnings,
	};
}

interface OwnedLine {
	owner: string;
	line: Polyline;
}

/**
 * Cut a small gap in a horizontal segment wherever another union's vertical
 * line passes through it, so a crossing never reads as a junction.
 */
function bridgeCrossings(lines: OwnedLine[], all: OwnedLine[]): Polyline[] {
	const gap = 4;
	const verticals: { owner: string; x: number; y1: number; y2: number }[] = [];
	for (const { owner, line } of all) {
		for (let i = 1; i < line.length; i++) {
			const [ax, ay] = line[i - 1];
			const [bx, by] = line[i];
			if (Math.abs(ax - bx) < 0.01) verticals.push({ owner, x: ax, y1: Math.min(ay, by), y2: Math.max(ay, by) });
		}
	}
	const out: Polyline[] = [];
	for (const { owner, line } of lines) {
		let cur: Polyline = [line[0]];
		for (let i = 1; i < line.length; i++) {
			const [ax, ay] = line[i - 1];
			const [bx, by] = line[i];
			if (Math.abs(ay - by) < 0.01) {
				const dir = bx >= ax ? 1 : -1;
				const lo = Math.min(ax, bx);
				const hi = Math.max(ax, bx);
				const cuts = verticals
					.filter((v) => v.owner !== owner && v.x > lo + gap && v.x < hi - gap && v.y1 < ay - 0.5 && v.y2 > ay + 0.5)
					.map((v) => v.x)
					.sort((p, q) => (p - q) * dir);
				for (const x of cuts) {
					cur.push([x - gap * dir, ay]);
					out.push(cur);
					cur = [[x + gap * dir, ay]];
				}
			}
			cur.push([bx, by]);
		}
		out.push(cur);
	}
	return out;
}

/** Horizontal space between neighbouring blocks: tighter for siblings. */
function gapBetween(a: Block, b: Block, parentUnion: Map<PersonId, Union>): number {
	const ua = parentUnion.get(a.members[a.members.length - 1]);
	const ub = parentUnion.get(b.members[0]);
	return ua && ua === ub ? METRICS.siblingGap : METRICS.familyGap;
}

/**
 * Order a set of partners into a row. A chain of marriages keeps its chain
 * order; a person with several spouses goes in the middle with spouses split
 * either side.
 */
function linearise(
	comp: PersonId[],
	adj: Map<PersonId, PersonId[]>,
	info: (id: PersonId) => PersonInfo,
): PersonId[] {
	if (comp.length === 1) return comp;
	const deg = (id: PersonId) => (adj.get(id) ?? []).length;
	const byOrder = (a: PersonId, b: PersonId) => comparePersons(info(a), info(b));
	const edges = comp.reduce((s, id) => s + deg(id), 0) / 2;
	const isPath = comp.every((id) => deg(id) <= 2) && edges === comp.length - 1;
	if (isPath) {
		const start = comp.filter((id) => deg(id) === 1).sort(byOrder)[0];
		const out = [start];
		const seen = new Set(out);
		let cur = start;
		for (;;) {
			const next = (adj.get(cur) ?? []).find((n) => !seen.has(n));
			if (!next) break;
			out.push(next);
			seen.add(next);
			cur = next;
		}
		return out;
	}
	const centre = comp.slice().sort((a, b) => deg(b) - deg(a) || byOrder(a, b))[0];
	const spouses = (adj.get(centre) ?? []).slice().sort(byOrder);
	const left: PersonId[] = [];
	const right: PersonId[] = [];
	spouses.forEach((s, i) => (i % 2 === 0 ? left.unshift(s) : right.push(s)));
	const placed = new Set([centre, ...spouses]);
	const rest = comp.filter((id) => !placed.has(id)).sort(byOrder);
	return [...left, centre, ...right, ...rest];
}

/**
 * Place items left to right, as close as possible (least squares, weighted)
 * to their desired left edges, without overlapping. Pool adjacent violators.
 */
export function isotonicPlace(
	items: { desired: number; weight: number }[],
	widths: number[],
	seps: number[],
): number[] {
	const off: number[] = [];
	let acc = 0;
	for (let i = 0; i < items.length; i++) {
		if (i > 0) acc += widths[i - 1] + seps[i];
		off.push(acc);
	}
	const pools: { n: number; w: number; wy: number }[] = [];
	for (let i = 0; i < items.length; i++) {
		const { desired, weight } = items[i];
		pools.push({ n: 1, w: weight, wy: weight * (desired - off[i]) });
		while (pools.length > 1) {
			const cur = pools[pools.length - 1];
			const prev = pools[pools.length - 2];
			if (prev.wy / prev.w <= cur.wy / cur.w) break;
			prev.n += cur.n;
			prev.w += cur.w;
			prev.wy += cur.wy;
			pools.pop();
		}
	}
	const out: number[] = [];
	let i = 0;
	for (const p of pools) {
		const base = p.wy / p.w;
		for (let k = 0; k < p.n; k++, i++) out.push(base + off[i]);
	}
	return out;
}

function claimTrack(tracks: Map<number, Array<[number, number]>>, g: number, lo: number, hi: number): number {
	if (!tracks.has(g)) tracks.set(g, []);
	// Each entry is the [lo, hi] extent already used on one track.
	const list = tracks.get(g) as Array<[number, number]>;
	const pad = 10;
	for (let t = 0; t < list.length; t++) {
		const [a, b] = list[t];
		if (hi + pad < a || lo - pad > b) {
			list[t] = [Math.min(a, lo), Math.max(b, hi)];
			return t;
		}
	}
	list.push([lo, hi]);
	return list.length - 1;
}

/**
 * Give each person a generation, oldest at 0. Partners (spouses and
 * co-parents) are merged into one generation unless that would put someone
 * above their own ancestor; those are reported and left apart.
 */
function assignGenerations(
	ids: PersonId[],
	info: (id: PersonId) => PersonInfo,
	childrenOf: Map<PersonId, PersonId[]>,
	unions: Map<string, Union>,
	warnings: LineageWarning[],
): Map<PersonId, number> {
	const parent = new Map<PersonId, PersonId>(ids.map((id) => [id, id]));
	const find = (id: PersonId): PersonId => {
		let r = id;
		while (parent.get(r) !== r) r = parent.get(r) as PersonId;
		parent.set(id, r);
		return r;
	};
	const members = new Map<PersonId, PersonId[]>(ids.map((id) => [id, [id]]));

	// Is there a descent path from any member of group `from` to group `to`?
	const reaches = (from: PersonId, to: PersonId): boolean => {
		const target = find(to);
		const seen = new Set<PersonId>([find(from)]);
		const queue = [find(from)];
		while (queue.length) {
			const g = queue.shift() as PersonId;
			for (const m of members.get(g) as PersonId[]) {
				for (const c of childrenOf.get(m) ?? []) {
					const cg = find(c);
					if (cg === target) return true;
					if (!seen.has(cg)) {
						seen.add(cg);
						queue.push(cg);
					}
				}
			}
		}
		return false;
	};

	const pairs = Array.from(unions.values())
		.filter((u) => u.partners.length === 2)
		.sort((a, b) => a.key.localeCompare(b.key));
	for (const u of pairs) {
		const [a, b] = u.partners;
		const ra = find(a);
		const rb = find(b);
		if (ra === rb) continue;
		if (reaches(a, b) || reaches(b, a)) {
			warnings.push({
				message: `${info(a).name} and ${info(b).name} are partners but one descends from the other, so they are drawn in different generations.`,
				path: info(a).path ?? undefined,
				name: info(a).name,
			});
			continue;
		}
		parent.set(rb, ra);
		members.set(ra, [...(members.get(ra) as PersonId[]), ...(members.get(rb) as PersonId[])]);
		members.delete(rb);
	}

	// Group DAG and topological order.
	const groups = Array.from(members.keys());
	const childGroups = new Map<PersonId, Set<PersonId>>(groups.map((g) => [g, new Set()]));
	const parentGroups = new Map<PersonId, Set<PersonId>>(groups.map((g) => [g, new Set()]));
	for (const g of groups) {
		for (const m of members.get(g) as PersonId[]) {
			for (const c of childrenOf.get(m) ?? []) {
				const cg = find(c);
				if (cg === g) continue;
				(childGroups.get(g) as Set<PersonId>).add(cg);
				(parentGroups.get(cg) as Set<PersonId>).add(g);
			}
		}
	}
	const indeg = new Map(groups.map((g) => [g, (parentGroups.get(g) as Set<PersonId>).size]));
	const topo: PersonId[] = [];
	const queue = groups.filter((g) => indeg.get(g) === 0);
	while (queue.length) {
		const g = queue.shift() as PersonId;
		topo.push(g);
		for (const c of childGroups.get(g) as Set<PersonId>) {
			indeg.set(c, (indeg.get(c) as number) - 1);
			if (indeg.get(c) === 0) queue.push(c);
		}
	}
	// Anything left over is in a cycle we failed to break; place it anyway.
	for (const g of groups) if (!topo.includes(g)) topo.push(g);

	const gGen = new Map<PersonId, number>();
	for (const g of topo) {
		let v = 0;
		for (const p of parentGroups.get(g) as Set<PersonId>) {
			if (gGen.has(p)) v = Math.max(v, (gGen.get(p) as number) + 1);
		}
		gGen.set(g, v);
	}
	// Pull childless-at-the-top ancestors down to sit just above their children.
	for (let i = topo.length - 1; i >= 0; i--) {
		const g = topo[i];
		const kids = childGroups.get(g) as Set<PersonId>;
		if ((parentGroups.get(g) as Set<PersonId>).size || !kids.size) continue;
		gGen.set(g, Math.min(...Array.from(kids).map((c) => gGen.get(c) as number)) - 1);
	}
	const min = Math.min(...Array.from(gGen.values()));
	const out = new Map<PersonId, number>();
	for (const id of ids) out.set(id, (gGen.get(find(id)) as number) - min);
	return out;
}
