import { GraphSource, isMissingId, LineageWarning, PersonId, SpousePair, Tree } from "./types";

/** Generation limits relative to the seed: how many up, and how many down. */
export interface Generations {
	ancestors: number;
	descendants: number;
}

/** How far a tree reaches: relationship hops in any direction, or generations up and down. */
export type Reach = number | Generations;

/** Collect the people to draw from the seed, then the edges between them. */
export function buildTree(source: GraphSource, seed: PersonId, reach: Reach): Tree {
	const included = typeof reach === "number" ? byHops(source, seed, reach) : byGenerations(source, seed, reach);

	// A child drawn with one parent while the other parent, or whoever raised
	// them, exists would look wrong, so once either parent is in the tree pull
	// in the rest even past the limits (not traversed).
	let added = true;
	while (added) {
		added = false;
		for (const id of Array.from(included)) {
			const ps = source.parents(id);
			if (!ps.some((p) => included.has(p))) continue;
			for (const p of [...ps, ...source.raisedBy(id)]) {
				if (!included.has(p)) {
					included.add(p);
					added = true;
				}
			}
		}
	}

	const persons = new Map(Array.from(included).map((id) => [id, source.info(id)]));
	const warnings: LineageWarning[] = [];
	for (const id of persons.keys()) warnings.push(...source.issues(id));

	let parentEdges: [PersonId, PersonId][] = [];
	let raisedEdges: [PersonId, PersonId][] = [];
	const spousePairs: SpousePair[] = [];
	const seenPair = new Set<string>();
	for (const id of persons.keys()) {
		for (const p of source.parents(id)) {
			if (persons.has(p)) parentEdges.push([p, id]);
		}
		for (const r of source.raisedBy(id)) {
			if (persons.has(r)) raisedEdges.push([r, id]);
		}
		for (const s of source.spouses(id)) {
			if (!persons.has(s)) continue;
			const key = pairKey(id, s);
			if (seenPair.has(key)) continue;
			seenPair.add(key);
			// Either note may record the year. If both do and disagree, keep this one's and say so.
			const own = source.marriedYear(id, s);
			const theirs = source.marriedYear(s, id);
			if (own !== null && theirs !== null && own !== theirs) {
				const a = persons.get(id);
				const b = persons.get(s);
				warnings.push({
					message: `${a?.name} and ${b?.name} have different marriage years on their notes (${own} and ${theirs}). Using ${own}.`,
					path: a?.path ?? undefined,
					name: a?.name,
				});
			}
			spousePairs.push([id, s, own ?? theirs]);
		}
	}

	// Whoever raised someone is drawn above them too, so both kinds of edge
	// must be loop-free together.
	const raisedKeys = new Set(raisedEdges.map(([r, c]) => `${r}\u0000${c}`));
	const kept = new Set(
		breakCycles(persons, [...parentEdges, ...raisedEdges], warnings, raisedKeys).map(([p, c]) => `${p}\u0000${c}`),
	);
	parentEdges = parentEdges.filter(([p, c]) => kept.has(`${p}\u0000${c}`));
	raisedEdges = raisedEdges.filter(([r, c]) => kept.has(`${r}\u0000${c}`));

	return { seed, persons, parentEdges, raisedEdges, spousePairs, warnings: dedupe(warnings) };
}

/**
 * Breadth-first walk from the seed. Parent, child, spouse and raised-by edges
 * each cost one hop. Missing notes are shown but never expanded.
 */
function byHops(source: GraphSource, seed: PersonId, depth: number): Set<PersonId> {
	const dist = new Map<PersonId, number>([[seed, 0]]);
	const queue: PersonId[] = [seed];
	while (queue.length) {
		const id = queue.shift() as PersonId;
		const d = dist.get(id) as number;
		if (d >= depth || isMissingId(id)) continue;
		for (const n of neighbours(source, id)) {
			if (!dist.has(n)) {
				dist.set(n, d + 1);
				queue.push(n);
			}
		}
	}
	return new Set(dist.keys());
}

/**
 * Whole generations: the seed's ancestors up to `ancestors` generations, then
 * everyone descended from them down to `descendants` generations below the
 * seed, so siblings, aunts, uncles and cousins in that band are included.
 * Spouses of everyone found are drawn but not followed. Whoever raised
 * someone counts as a parent here. Missing notes are shown but never expanded.
 */
function byGenerations(source: GraphSource, seed: PersonId, { ancestors, descendants }: Generations): Set<PersonId> {
	// Generation relative to the seed: negative above, positive below.
	const up = new Map<PersonId, number>([[seed, 0]]);
	let frontier: PersonId[] = [seed];
	for (let g = -1; g >= -ancestors && frontier.length; g--) {
		const next: PersonId[] = [];
		for (const id of frontier) {
			if (isMissingId(id)) continue;
			for (const p of [...source.parents(id), ...source.raisedBy(id)]) {
				if (!up.has(p)) {
					up.set(p, g);
					next.push(p);
				}
			}
		}
		frontier = next;
	}

	// Walk down from the oldest generation first, so anyone reachable by two
	// routes is placed by the higher one and keeps the most of their line.
	const byGen = new Map<number, PersonId[]>();
	const add = (g: number, id: PersonId) => {
		const list = byGen.get(g);
		if (list) list.push(id);
		else byGen.set(g, [id]);
	};
	for (const [id, g] of up) add(g, id);
	const found = new Set<PersonId>();
	for (let g = -ancestors; g <= descendants; g++) {
		for (const id of byGen.get(g) ?? []) {
			if (found.has(id)) continue;
			found.add(id);
			if (g === descendants || isMissingId(id)) continue;
			for (const c of [...source.children(id), ...source.raisedChildren(id)]) if (!found.has(c)) add(g + 1, c);
		}
	}

	for (const id of Array.from(found)) {
		if (!isMissingId(id)) for (const s of source.spouses(id)) found.add(s);
	}
	return found;
}

function neighbours(source: GraphSource, id: PersonId): PersonId[] {
	return [
		...source.parents(id),
		...source.children(id),
		...source.spouses(id),
		...source.raisedBy(id),
		...source.raisedChildren(id),
	];
}

export function pairKey(a: string, b: string): string {
	return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** Drop parent edges that close an ancestry loop, and report each one. */
function breakCycles(
	persons: Tree["persons"],
	edges: [PersonId, PersonId][],
	warnings: LineageWarning[],
	raisedKeys: Set<string>,
): [PersonId, PersonId][] {
	const out = new Map<PersonId, PersonId[]>();
	for (const [p, c] of edges) {
		if (!out.has(p)) out.set(p, []);
		(out.get(p) as PersonId[]).push(c);
	}
	const state = new Map<PersonId, 1 | 2>(); // 1 = on stack, 2 = done
	const dropped = new Set<string>();

	// Iterative DFS so deep lineages cannot overflow the stack.
	const ids = Array.from(persons.keys()).sort();
	for (const root of ids) {
		if (state.has(root)) continue;
		const stack: { id: PersonId; i: number }[] = [{ id: root, i: 0 }];
		state.set(root, 1);
		while (stack.length) {
			const top = stack[stack.length - 1];
			const kids = out.get(top.id) ?? [];
			if (top.i >= kids.length) {
				state.set(top.id, 2);
				stack.pop();
				continue;
			}
			const c = kids[top.i++];
			const s = state.get(c);
			if (s === 1) {
				const key = `${top.id}\u0000${c}`;
				dropped.add(key);
				const parent = persons.get(top.id);
				const child = persons.get(c);
				const role = raisedKeys.has(key) ? "the person who raised them," : "parent";
				warnings.push({
					message: `Ancestry cycle: ${child?.name} is recorded as their own ancestor. The link to ${role} ${parent?.name} was ignored.`,
					path: child?.path ?? undefined,
					name: child?.name,
				});
			} else if (!s) {
				state.set(c, 1);
				stack.push({ id: c, i: 0 });
			}
		}
	}
	return edges.filter(([p, c]) => !dropped.has(`${p}\u0000${c}`));
}

function dedupe(ws: LineageWarning[]): LineageWarning[] {
	const seen = new Set<string>();
	return ws.filter((w) => {
		const k = `${w.path}|${w.message}`;
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}
