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

test("declared spouses get a marriage line; unmarried co-parents a partner line", () => {
	const married = layoutTree(buildTree(store, P("Brannoc Thornvale"), 1), measure);
	assert.ok(married.marriageLines.length > 0, "Brannoc's marriages are drawn solid");
	assert.equal(married.partnerLines.length, 0, "no dashed lines when every couple is married");

	// One-sided declaration: only Aldric lists Ysolde, and that alone makes them married.
	const oneSided = layoutTree(buildTree(store, P("Ysolde Thornvale"), 1), measure);
	assert.ok(oneSided.marriageLines.length > 0);
	assert.equal(oneSided.partnerLines.length, 0);

	const unwed = layoutTree(buildTree(store, "Edge cases/Ember Marsh.md", 1), measure);
	assert.equal(unwed.marriageLines.length, 0, "Lysa and Tavin are not spouses");
	assert.equal(unwed.partnerLines.length, 1, "they are joined by one dashed line");
	assert.ok(unwed.descentLines.length > 0, "Ember still hangs from her parents");
});

test("Married years pair with spouses in order; ? and blanks are unknown", () => {
	const resolve = (l: string) => ({ path: `${l}.md` });
	const rec = (fm: Record<string, unknown>) => parseRecord("A.md", fm, DEFAULT_PROPS, resolve);

	assert.deepEqual(rec({ Spouse: "[[B]]", Married: 1355 }).marriedYears, [["B.md", 1355]]);
	assert.deepEqual(rec({ Spouse: "[[B]]", married: "1355" }).marriedYears, [["B.md", 1355]], "string year, any case");
	assert.deepEqual(
		rec({ Spouse: ["[[B]]", "[[C]]", "[[D]]"], Married: ["?", 1418, null] }).marriedYears,
		[["C.md", 1418]],
		"unknown first and third years",
	);
	assert.deepEqual(rec({ Spouse: ["[[B]]", "[[C]]"] }).marriedYears, [], "no Married at all");

	const bad = rec({ Spouse: "[[B]]", Married: "spring 1355" });
	assert.deepEqual(bad.marriedYears, []);
	assert.match(bad.issues[0].message, /not a whole year/);

	const extra = rec({ Spouse: "[[B]]", Married: [1355, 1360] });
	assert.deepEqual(extra.marriedYears, [["B.md", 1355]]);
	assert.match(extra.issues[0].message, /2 Married years but 1 spouse links/);
});

test("a marriage year can come from either spouse; disagreements are warned", () => {
	const resolve = (l: string) => ({ path: `${l}.md` });
	const s = new RelationshipStore();
	s.set(parseRecord("A.md", { Spouse: "[[B]]" }, DEFAULT_PROPS, resolve));
	s.set(parseRecord("B.md", { Spouse: "[[A]]", Married: 1355 }, DEFAULT_PROPS, resolve));
	assert.deepEqual(buildTree(s, "A.md", 1).spousePairs, [["A.md", "B.md", 1355]]);

	s.set(parseRecord("A.md", { Spouse: "[[B]]", Married: 1356 }, DEFAULT_PROPS, resolve));
	const t = buildTree(s, "A.md", 1);
	assert.equal(t.spousePairs[0][2], 1356);
	assert.match(t.warnings.map((w) => w.message).join("\n"), /different marriage years on their notes \(1356 and 1355\)/);
});

test("marriage labels sit above the line, in a gap wide enough for them", () => {
	const layout = layoutTree(buildTree(store, P("Brannoc Thornvale"), 1), measure);
	assert.deepEqual(layout.marriageLabels.map((l) => l.text).sort(), ["m. 1380", "m. 1407", "m. 1418"]);
	for (const l of layout.marriageLabels) {
		const w = measure(l.text, "years");
		const row = layout.nodes.filter((n) => Math.abs(n.y - (l.y - METRICS.nameMid + 3)) < 0.01);
		assert.ok(row.length > 0, `${l.text} sits on a row of names`);
		for (const n of row) {
			const clear = l.x + w / 2 <= n.x - n.width / 2 || l.x - w / 2 >= n.x + n.width / 2;
			assert.ok(clear, `${l.text} does not overlap ${n.info.name}`);
		}
	}

	// No year, no label: Aldric and Ysolde are married with no date given.
	assert.equal(layoutTree(buildTree(store, P("Ysolde Thornvale"), 1), measure).marriageLabels.length, 0);
	// Unmarried co-parents never get one.
	assert.equal(layoutTree(buildTree(store, "Edge cases/Ember Marsh.md", 1), measure).marriageLabels.length, 0);
});

test("Raised by is parsed, reverse-indexed and traversed like a parent", () => {
	const resolve = (l: string) => ({ path: `${l}.md` });
	const rec = (fm: Record<string, unknown>) => parseRecord("A.md", fm, DEFAULT_PROPS, resolve);
	assert.deepEqual(rec({ "raised by": ["[[B]]", "[[C]]"] }).raisedBy, ["B.md", "C.md"], "list, any case");
	const both = rec({ Mother: "[[B]]", "Raised by": ["[[B]]", "[[C]]"] });
	assert.deepEqual(both.raisedBy, ["C.md"], "a parent is not also a raiser");
	assert.match(both.issues[0].message, /both a parent and Raised by/);
	assert.match(rec({ "Raised by": "[[A]]" }).issues[0].message, /lists themselves as raised by/);

	const oda = "Edge cases/Oda Marsh.md";
	assert.deepEqual(store.raisedChildren(oda).sort(), ["Edge cases/Ember Marsh.md", "Edge cases/Finch Marsh.md"]);
	const t = buildTree(store, oda, 1);
	assert.deepEqual(names(t), ["Ember Marsh", "Finch Marsh", "Oda Marsh"]);
	assert.equal(t.parentEdges.length, 0);
	assert.equal(t.raisedEdges.length, 2);
});

test("raised children sit below whoever raised them, joined by dotted lines", () => {
	const ember = "Edge cases/Ember Marsh.md";
	const layout = layoutTree(buildTree(store, ember, 1), measure);
	const node = new Map(layout.nodes.map((n) => [n.info.name, n]));
	for (const parent of ["Oda Marsh", "Lysa Marsh", "Tavin Cole"]) {
		assert.ok(node.get(parent)!.gen < node.get("Ember Marsh")!.gen, `${parent} above Ember`);
	}
	assert.ok(layout.descentLines.length > 0, "solid line from her parents");
	assert.ok(layout.raisedLines.length > 0, "dotted line from Oda");
	// With her real parents also drawn, the dotted line meets her just to one side.
	const e = node.get("Ember Marsh")!;
	const ends = layout.raisedLines.map((l) => l[l.length - 1]);
	assert.ok(ends.some(([x, y]) => Math.abs(y - (e.y - 3)) < 0.01 && x > e.x + 1), "dotted line offset from the solid one");

	// A foundling with nobody but Oda is placed under her like a child.
	const solo = layoutTree(buildTree(store, "Edge cases/Finch Marsh.md", 1), measure);
	const sn = new Map(solo.nodes.map((n) => [n.info.name, n]));
	assert.equal(solo.descentLines.length, 0);
	assert.ok(solo.raisedLines.length > 0);
	assert.ok(Math.abs(sn.get("Finch Marsh")!.x - sn.get("Oda Marsh")!.x) < 1, "Finch sits centred under Oda");
});

test("a loop through Raised by is broken and named", () => {
	const resolve = (l: string) => ({ path: `${l}.md` });
	const s = new RelationshipStore();
	s.set(parseRecord("A.md", { "Raised by": "[[B]]" }, DEFAULT_PROPS, resolve));
	s.set(parseRecord("B.md", { Mother: "[[A]]" }, DEFAULT_PROPS, resolve));
	const t = buildTree(s, "A.md", 3);
	assert.equal(t.parentEdges.length + t.raisedEdges.length, 1, "one of the two links is dropped");
	assert.match(t.warnings.map((w) => w.message).join("\n"), /Ancestry cycle/);
	assert.doesNotThrow(() => layoutTree(t, measure));
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
