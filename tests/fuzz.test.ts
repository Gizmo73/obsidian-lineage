import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTree } from "../src/graph";
import { layoutTree, METRICS } from "../src/layout";
import { parseRecord, RelationshipStore } from "../src/store";
import { DEFAULT_PROPS } from "./vault";

// Small deterministic PRNG so failures are reproducible.
function rng(seed: number) {
	return () => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
}

function randomFamily(seed: number, n: number) {
	const r = rng(seed);
	const store = new RelationshipStore();
	const resolve = (l: string) => (l.startsWith("ghost") ? null : { path: `${l}.md` });
	for (let i = 0; i < n; i++) {
		const fm: Record<string, unknown> = {};
		// Mostly older people as parents (lower index), sometimes anything (cycles), sometimes self.
		const parent = () => (r() < 0.9 && i > 0 ? `P${Math.floor(r() * i)}` : r() < 0.5 ? `P${Math.floor(r() * n)}` : `ghost${i}`);
		if (r() < 0.8) fm.Mother = `[[${parent()}]]`;
		if (r() < 0.7) fm.Father = `[[${parent()}]]`;
		if (r() < 0.4) fm.Spouse = Array.from({ length: 1 + Math.floor(r() * 2) }, () => `[[P${Math.floor(r() * n)}]]`);
		if (r() < 0.7) fm.Born = r() < 0.9 ? 1300 + i : "unknown";
		store.set(parseRecord(`P${i}.md`, fm, DEFAULT_PROPS, resolve));
	}
	return store;
}

test("random messy families never crash and keep layout invariants", () => {
	for (let s = 1; s <= 60; s++) {
		const store = randomFamily(s, 10 + (s % 50));
		const tree = buildTree(store, "P0.md", 4 + (s % 5));
		const layout = layoutTree(tree, (t) => t.length * 7);
		const node = new Map(layout.nodes.map((n) => [n.id, n]));
		assert.equal(layout.nodes.length, tree.persons.size);
		for (const [p, c] of tree.parentEdges) assert.ok(node.get(p)!.gen < node.get(c)!.gen, `seed ${s}: ${p} above ${c}`);
		for (const n of layout.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `seed ${s}: finite coords`);
		const rows = new Map<number, typeof layout.nodes>();
		for (const n of layout.nodes) rows.set(n.gen, [...(rows.get(n.gen) ?? []), n]);
		for (const row of rows.values()) {
			row.sort((a, b) => a.x - b.x);
			for (let i = 1; i < row.length; i++) {
				const gap = row[i].x - row[i].width / 2 - (row[i - 1].x + row[i - 1].width / 2);
				assert.ok(gap >= METRICS.siblingGap - 0.01, `seed ${s}: overlap`);
			}
		}
	}
});

test("a 600-person tree lays out quickly", () => {
	const store = randomFamily(7, 600);
	const tree = buildTree(store, "P0.md", 50);
	const t0 = Date.now();
	layoutTree(tree, (t) => t.length * 7);
	const ms = Date.now() - t0;
	assert.ok(tree.persons.size > 300, `size ${tree.persons.size}`);
	assert.ok(ms < 2000, `took ${ms}ms`);
	console.log(`# ${tree.persons.size} people laid out in ${ms}ms`);
});
