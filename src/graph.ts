import { GraphSource, isMissingId, LineageWarning, PersonId, Tree } from "./types";

/**
 * Breadth-first walk from the seed. Parent, child and spouse edges each cost
 * one hop. Missing notes are shown but never expanded.
 */
export function buildTree(source: GraphSource, seed: PersonId, depth: number): Tree {
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

	// A child drawn with one parent while the other parent exists would look
	// wrong, so pull in co-parents even past the depth limit (not traversed).
	let added = true;
	while (added) {
		added = false;
		for (const id of Array.from(dist.keys())) {
			const ps = source.parents(id);
			if (ps.length < 2 || !ps.some((p) => dist.has(p))) continue;
			for (const p of ps) {
				if (!dist.has(p)) {
					dist.set(p, Infinity);
					added = true;
				}
			}
		}
	}

	const persons = new Map(Array.from(dist.keys()).map((id) => [id, source.info(id)]));
	const warnings: LineageWarning[] = [];
	for (const id of persons.keys()) warnings.push(...source.issues(id));

	let parentEdges: [PersonId, PersonId][] = [];
	const spousePairs: [PersonId, PersonId][] = [];
	const seenPair = new Set<string>();
	for (const id of persons.keys()) {
		for (const p of source.parents(id)) {
			if (persons.has(p)) parentEdges.push([p, id]);
		}
		for (const s of source.spouses(id)) {
			if (!persons.has(s)) continue;
			const key = pairKey(id, s);
			if (seenPair.has(key)) continue;
			seenPair.add(key);
			spousePairs.push([id, s]);
		}
	}

	parentEdges = breakCycles(persons, parentEdges, warnings);

	return { seed, persons, parentEdges, spousePairs, warnings: dedupe(warnings) };
}

function neighbours(source: GraphSource, id: PersonId): PersonId[] {
	return [...source.parents(id), ...source.children(id), ...source.spouses(id)];
}

export function pairKey(a: string, b: string): string {
	return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** Drop parent edges that close an ancestry loop, and report each one. */
function breakCycles(
	persons: Tree["persons"],
	edges: [PersonId, PersonId][],
	warnings: LineageWarning[],
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
				dropped.add(`${top.id}\u0000${c}`);
				const parent = persons.get(top.id);
				const child = persons.get(c);
				warnings.push({
					message: `Ancestry cycle: ${child?.name} is recorded as their own ancestor. The link to parent ${parent?.name} was ignored.`,
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
