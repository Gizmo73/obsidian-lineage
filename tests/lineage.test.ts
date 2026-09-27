import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTree } from "../src/graph";
import { isotonicPlace, layoutTree, METRICS } from "../src/layout";
import { extractLinkTexts, parseRecord, parseYear, RelationshipStore } from "../src/store";
import { Tree } from "../src/types";
import { parseBlockOptions } from "../src/options";
import { DEFAULT_PROPS, loadVault } from "./vault";

const P = (name: string) => `People/${name}.md`;
const { store } = loadVault();
const names = (t: Tree) => Array.from(t.persons.values()).map((p) => p.name).sort();
const measure = (s: string, kind: "name" | "years") => s.length * (kind === "name" ? 7 : 6);

test("link extraction handles quoted, unquoted, aliased and plain values", () => {
	assert.deepEqual(extractLinkTexts("[[A]]"), ["A"]);
	assert.deepEqual(extractLinkTexts(["[[A|Alias]]", "[[B#Heading]]"]), ["A", "B"]);
	assert.deepEqual(extractLinkTexts([["A"]]), ["A"]); // Mother: [[A]] without quotes
	assert.deepEqual(extractLinkTexts("Lady Ashgrove"), []);
	assert.deepEqual(extractLinkTexts(undefined), []);
});

test("years parse as integers only", () => {
	assert.equal(parseYear(1385), 1385);
	assert.equal(parseYear("1385"), 1385);
	assert.equal(parseYear(undefined), null);
	assert.equal(parseYear("circa 1380"), "bad");
	assert.equal(parseYear(1472.5), "bad");
});

test("children and spouses come from reverse lookups", () => {
	assert.deepEqual(store.children(P("Brannoc Thornvale")).sort(), [
		P("Garrick Thornvale"),
		P("Liesel Thornvale"),
		P("Pell Thornvale"),
	]);
	// Tobin declares nothing; Sera declares Tobin.
	assert.deepEqual(store.spouses(P("Tobin Reed")), [P("Sera Thornvale")]);
	// Ysolde declares nothing; Aldric declares Ysolde.
	assert.deepEqual(store.spouses(P("Ysolde Thornvale")), [P("Aldric Thornvale")]);
});

test("mixed-case property names are read", () => {
	assert.deepEqual(store.spouses(P("Maren Hale")).sort(), [P("Oswin Hale")]);
	assert.deepEqual(store.parents(P("Edric Hale")).sort(), [P("Maren Hale"), P("Oswin Hale")]);
	assert.equal(store.info(P("Maren Hale")).died, 1400);
});

test("depth 0 is the seed only; depth 1 adds parents, spouses and children", () => {
	assert.deepEqual(names(buildTree(store, P("Brannoc Thornvale"), 0)), ["Brannoc Thornvale"]);
	assert.deepEqual(names(buildTree(store, P("Brannoc Thornvale"), 1)), [
		"Aelira Thornvale",
		"Brannoc Thornvale",
		"Corvin Thornvale",
		"Garrick Thornvale",
		"Isolde Fenwick",
		"Liesel Thornvale",
		"Mirela Ashgrove",
		"Pell Thornvale",
	]);
});

test("co-parents beyond the depth limit are pulled in", () => {
	// A and B are unmarried co-parents of C. From A at depth 1, C is one hop
	// away and B is two, but B must still be drawn so C has both parents.
	const s = new RelationshipStore();
	const resolve = (l: string) => ({ path: `${l}.md` });
	s.set(parseRecord("A.md", {}, DEFAULT_PROPS, resolve));
	s.set(parseRecord("B.md", {}, DEFAULT_PROPS, resolve));
	s.set(parseRecord("C.md", { Mother: "[[A]]", Father: "[[B]]" }, DEFAULT_PROPS, resolve));
	assert.deepEqual(names(buildTree(s, "A.md", 1)), ["A", "B", "C"]);
});

test("missing notes are shown but not linked or traversed", () => {
	const t = buildTree(store, P("Mirela Ashgrove"), 3);
	const hadrian = t.persons.get("missing:hadrian ashgrove");
	assert.ok(hadrian);
	assert.equal(hadrian.path, null);
	assert.equal(hadrian.name, "Hadrian Ashgrove");
	assert.ok(!names(t).includes("Lady Ashgrove"));
});

test("intermarriage: everyone appears exactly once", () => {
	const t = buildTree(store, P("Tamsin Thornvale"), 10);
	const layout = layoutTree(t, measure);
	const ids = layout.nodes.map((n) => n.id);
	assert.equal(new Set(ids).size, ids.length);
	assert.ok(t.persons.has(P("Oswin Hale")));
	assert.equal(t.persons.size, 21); // 20 notes plus missing Hadrian Ashgrove
});

test("cycles and self references produce warnings, not crashes", () => {
	const t = buildTree(store, "Edge cases/Vesper Loop.md", 5);
	const msgs = t.warnings.map((w) => w.message).join("\n");
	assert.match(msgs, /Ancestry cycle/);
	assert.match(msgs, /Narcissa Vane lists themselves as mother/);
	assert.match(msgs, /lists themselves as spouse/);
	assert.match(msgs, /Born value "1472.5"/);
	const layout = layoutTree(t, measure);
	assert.equal(layout.nodes.length, t.persons.size);
});

test("bad years are unknown and warned", () => {
	const t = buildTree(store, P("Tobin Reed"), 0);
	assert.equal(t.persons.get(P("Tobin Reed"))?.born, null);
	assert.match(t.warnings[0].message, /circa 1380/);
});

test("layout keeps parents above children, partners level, and no overlaps", () => {
	for (const [seed, depth] of [
		[P("Tamsin Thornvale"), 10],
		[P("Brannoc Thornvale"), 3],
		["Edge cases/Vesper Loop.md", 5],
	] as const) {
		const t = buildTree(store, seed, depth);
		const layout = layoutTree(t, measure);
		const node = new Map(layout.nodes.map((n) => [n.id, n]));
		for (const [p, c] of t.parentEdges) {
			assert.ok(node.get(p)!.gen < node.get(c)!.gen, `${p} above ${c}`);
		}
		for (const [a, b] of t.spousePairs) {
			if (layout.warnings.length) continue;
			assert.equal(node.get(a)!.gen, node.get(b)!.gen, `${a} level with ${b}`);
		}
		const byGen = new Map<number, typeof layout.nodes>();
		for (const n of layout.nodes) byGen.set(n.gen, [...(byGen.get(n.gen) ?? []), n]);
		for (const row of byGen.values()) {
			row.sort((a, b) => a.x - b.x);
			for (let i = 1; i < row.length; i++) {
				const gap = row[i].x - row[i].width / 2 - (row[i - 1].x + row[i - 1].width / 2);
				assert.ok(gap >= METRICS.siblingGap - 0.01, `overlap between ${row[i - 1].id} and ${row[i].id}`);
			}
		}
	}
});

test("siblings are ordered by birth year, unknown last", () => {
	const t = buildTree(store, P("Corvin Thornvale"), 1);
	const layout = layoutTree(t, measure);
	const order = layout.nodes
		.filter((n) => ["Brannoc Thornvale", "Sera Thornvale", "Wren Thornvale"].includes(n.info.name))
		.sort((a, b) => a.x - b.x)
		.map((n) => n.info.name);
	assert.deepEqual(order, ["Brannoc Thornvale", "Sera Thornvale", "Wren Thornvale"]);
});

test("isotonic placement respects order and spacing", () => {
	const lefts = isotonicPlace(
		[
			{ desired: 10, weight: 1 },
			{ desired: 0, weight: 1 },
			{ desired: 100, weight: 1 },
		],
		[20, 20, 20],
		[0, 10, 10],
	);
	assert.ok(lefts[1] >= lefts[0] + 30 - 1e-9);
	assert.equal(lefts[2], 100);
});

test("block options: seed forms, defaults and bad values", () => {
	const d = { depth: 3, height: 500 };
	assert.equal(parseBlockOptions("seed: [[Aelira Thornvale]]", d).seed, "Aelira Thornvale");
	assert.equal(parseBlockOptions('seed: "[[People/Aelira Thornvale|Aelira]]"', d).seed, "People/Aelira Thornvale");
	assert.equal(parseBlockOptions("seed: Aelira Thornvale", d).seed, "Aelira Thornvale");
	assert.equal(parseBlockOptions("depth: 2", d).seed, null);
	const o = parseBlockOptions("seed: [[A]]\nDepth: 0\nheight: 20\ncolour: red", d);
	assert.equal(o.depth, 0);
	assert.equal(o.height, 500);
	assert.equal(o.problems.length, 2);
});
