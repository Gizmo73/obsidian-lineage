import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTree } from "../src/graph";
import { VaultIndex } from "../src/vault-index";
import { fakeApp, TFile } from "./obsidian-mock";
import { DEFAULT_PROPS } from "./vault";

function setup() {
	const notes: Record<string, Record<string, unknown>> = {
		"A.md": { Born: 1400 },
		"B.md": { Mother: "[[A]]" },
		"X.md": { aliases: ["Xavier"] },
	};
	const app = fakeApp(notes);
	const index = new VaultIndex(app as any, () => DEFAULT_PROPS);
	let calls = 0;
	index.subscribe(() => calls++);
	index.ensureBuilt();
	const change = (path: string, fm: Record<string, unknown>) => {
		notes[path] = fm;
		index.onMetadataChanged(new TFile(path) as any, { frontmatter: fm } as any);
	};
	return { notes, index, change, calls: () => calls };
}

test("adding a Mother link updates the tree without a rebuild", () => {
	const { index, change, calls } = setup();
	assert.deepEqual(index.store.children("A.md"), ["B.md"]);
	change("X.md", { aliases: ["Xavier"], Mother: "[[A]]" });
	assert.equal(calls(), 1);
	assert.deepEqual(index.store.children("A.md").sort(), ["B.md", "X.md"]);
	assert.equal(buildTree(index.store, "A.md", 1).persons.size, 3);
});

test("edits that do not touch relationships do not redraw", () => {
	const { change, calls } = setup();
	change("A.md", { Born: 1400, tags: ["family"] });
	assert.equal(calls(), 0);
});

test("a new note triggers a full rebuild, resolving links that were missing", () => {
	const { index, change, notes } = setup();
	change("B.md", { Mother: "[[A]]", Father: "[[C]]" });
	assert.deepEqual(index.store.parents("B.md"), ["A.md", "missing:c"]);
	notes["C.md"] = {};
	index.onMetadataChanged(new TFile("C.md") as any, { frontmatter: {} } as any);
	index.ensureBuilt();
	assert.deepEqual(index.store.parents("B.md"), ["A.md", "C.md"]);
});

test("seeds and relationship links resolve through aliases", () => {
	const { index, change } = setup();
	assert.equal(index.resolve("Xavier", "")?.path, "X.md");
	assert.equal(index.resolve("xavier", "")?.path, "X.md");
	change("B.md", { Mother: "[[A]]", Father: "[[Xavier]]" });
	assert.deepEqual(index.store.parents("B.md"), ["A.md", "X.md"]);
});
