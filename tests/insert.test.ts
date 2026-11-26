import assert from "node:assert/strict";
import { test } from "node:test";
import { blockInsertion, depthChoices, formatBlock, inFolder, seedCandidates } from "../src/insert";
import { parseBlockOptions } from "../src/options";

const file = (path: string) => ({ path, basename: (path.split("/").pop() ?? "").replace(/\.md$/, "") });

test("folder matching includes subfolders, ignores case and treats blank as the whole vault", () => {
	assert.ok(inFolder("People/Hale/Maren Hale.md", "People"));
	assert.ok(inFolder("People/Maren Hale.md", "/people/"));
	assert.ok(!inFolder("Peoples/Maren Hale.md", "People"));
	assert.ok(!inFolder("People.md", "People"));
	assert.ok(inFolder("Anything.md", ""));
});

test("seed candidates are the folder's notes by name, with the current note first", () => {
	const files = ["People/Wren.md", "Places/Ashgrove.md", "People/Hale/Aldric.md", "People/Maren.md"].map(file);
	const names = (list: { basename: string }[]) => list.map((f) => f.basename);
	assert.deepEqual(names(seedCandidates(files, "People")), ["Aldric", "Maren", "Wren"]);
	assert.deepEqual(names(seedCandidates(files, "People", "People/Wren.md")), ["Wren", "Aldric", "Maren"]);
	assert.deepEqual(names(seedCandidates(files, "People", "Places/Ashgrove.md")), ["Aldric", "Maren", "Wren"]);
	assert.equal(seedCandidates(files, "").length, 4);
	assert.equal(seedCandidates(files, "Nowhere").length, 0);
});

test("depth choices put the default first and accept any typed whole number", () => {
	assert.deepEqual(depthChoices("", 3), [3, 0, 1, 2, 4, 5, 6]);
	assert.deepEqual(depthChoices("", 10), [10, 0, 1, 2, 3, 4, 5, 6]);
	assert.deepEqual(depthChoices(" 12 ", 3), [12]);
	assert.deepEqual(depthChoices("0", 3), [0]);
	assert.deepEqual(depthChoices("-1", 3), []);
	assert.deepEqual(depthChoices("2.5", 3), []);
	assert.deepEqual(depthChoices("deep", 3), []);
});

test("the inserted block reads back as the chosen seed and depth", () => {
	const block = formatBlock("People/Aelira Thornvale", 2);
	assert.equal(block, "```lineage\nseed: [[People/Aelira Thornvale]]\ndepth: 2\n```");
	const opts = parseBlockOptions(block.split("\n").slice(1, -1).join("\n"), { depth: 3, height: 500 });
	assert.equal(opts.seed, "People/Aelira Thornvale");
	assert.equal(opts.depth, 2);
	assert.deepEqual(opts.problems, []);
});

test("the block starts on its own line when the cursor is mid-line", () => {
	assert.equal(blockInsertion("B", ""), "B\n");
	assert.equal(blockInsertion("B", "Some text"), "\nB\n");
});
