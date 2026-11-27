import assert from "node:assert/strict";
import { test } from "node:test";
import { marriagesOf } from "../src/marriages";
import { parseRecord, RelationshipStore } from "../src/store";
import { DEFAULT_PROPS, loadVault } from "./vault";

const { store } = loadVault();
const P = (name: string) => `People/${name}.md`;
const shown = (id: string) => marriagesOf(store, id).map((m) => `${m.year ?? "?"} to ${m.name}`);

test("marriages run oldest first, one per spouse", () => {
	assert.deepEqual(shown(P("Brannoc Thornvale")), ["1407 to Mirela Ashgrove", "1418 to Isolde Fenwick"]);
	assert.deepEqual(shown(P("Edric Hale")), ["? to Brisa Hale"]);
	assert.deepEqual(shown(P("Pell Thornvale")), []);
});

test("a marriage or year recorded only on the other spouse's note still shows", () => {
	// Tobin's note names no spouse; Sera's names him.
	assert.deepEqual(shown(P("Tobin Reed")), ["? to Sera Thornvale"]);
	// Aelira's note has no Married year; Corvin's gives 1380.
	assert.deepEqual(shown(P("Aelira Thornvale")), ["1380 to Corvin Thornvale"]);
	// Isolde's own Spouse link and Brannoc's year for her.
	assert.deepEqual(shown(P("Isolde Fenwick")), ["1418 to Brannoc Thornvale"]);
});

test("unknown years go last, then by name, and missing notes have no path", () => {
	const s = new RelationshipStore();
	const resolve = (l: string) => (["B", "C", "D"].includes(l) ? { path: `${l}.md` } : null);
	s.set(parseRecord("A.md", { Spouse: ["[[D]]", "[[C]]", "[[Nobody]]", "[[B]]"], Married: ["?", "?", 1500, 1490] }, DEFAULT_PROPS, resolve));
	for (const p of ["B.md", "C.md", "D.md"]) s.set(parseRecord(p, {}, DEFAULT_PROPS, resolve));
	const list = marriagesOf(s, "A.md");
	assert.deepEqual(
		list.map((m) => `${m.year ?? "?"} ${m.name}`),
		["1490 B", "1500 Nobody", "? C", "? D"],
	);
	assert.equal(list.find((m) => m.name === "Nobody")?.path, null);
	assert.equal(list[0].path, "B.md");
});
