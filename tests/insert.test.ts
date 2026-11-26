import assert from "node:assert/strict";
import { test } from "node:test";
import { blockInsertion, countChoices, formatBlock, inFolder, seedCandidates } from "../src/insert";
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

test("count choices put the default first and accept any typed whole number", () => {
	assert.deepEqual(countChoices("", 3), [3, 0, 1, 2, 4, 5, 6]);
	assert.deepEqual(countChoices("", 10), [10, 0, 1, 2, 3, 4, 5, 6]);
	assert.deepEqual(countChoices(" 12 ", 3), [12]);
	assert.deepEqual(countChoices("0", 3), [0]);
	assert.deepEqual(countChoices("-1", 3), []);
	assert.deepEqual(countChoices("2.5", 3), []);
	assert.deepEqual(countChoices("deep", 3), []);
});

test("the inserted block reads back as the chosen seed and generations", () => {
	const block = formatBlock("People/Aelira Thornvale", { ancestors: 2, descendants: 0 });
	assert.equal(block, "```lineage\nseed: [[People/Aelira Thornvale]]\nancestors: 2\ndescendants: 0\n```");
	const defaults = { depth: 3, height: 500, ancestors: 1, descendants: 1 };
	const opts = parseBlockOptions(block.split("\n").slice(1, -1).join("\n"), defaults);
	assert.equal(opts.seed, "People/Aelira Thornvale");
	assert.deepEqual(opts.generations, { ancestors: 2, descendants: 0 });
	assert.deepEqual(opts.problems, []);
});

test("the block starts on its own line when the cursor is mid-line", () => {
	assert.equal(blockInsertion("B", ""), "B\n");
	assert.equal(blockInsertion("B", "Some text"), "\nB\n");
});
