import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBlockOptions, rewriteBody, withGenerations } from "../src/options";

const g = (ancestors: number, descendants: number) => ({ ancestors, descendants });

test("withGenerations replaces existing limits in place and keeps other lines", () => {
	assert.equal(
		withGenerations("seed: [[A]]\nancestors: 1\ndescendants: 1\nheight: 400", g(2, 0)),
		"seed: [[A]]\nancestors: 2\ndescendants: 0\nheight: 400",
	);
	// Only one of them given: both are written where it was.
	assert.equal(withGenerations("seed: [[A]]\nheight: 400\nDescendants: 3", g(1, 4)), "seed: [[A]]\nheight: 400\nancestors: 1\ndescendants: 4");
});

test("withGenerations turns a depth block into a generations block", () => {
	assert.equal(withGenerations("seed: [[A]]\ndepth: 3\nheight: 400", g(2, 2)), "seed: [[A]]\nancestors: 2\ndescendants: 2\nheight: 400");
	// Both depth and generations: depth goes, the limits are written once.
	assert.equal(withGenerations("depth: 3\nseed: [[A]]\nancestors: 9", g(1, 1)), "ancestors: 1\ndescendants: 1\nseed: [[A]]");
	// Neither: straight after the seed, keeping comments and indentation.
	assert.equal(withGenerations("# family\n  seed: [[A]]\n  height: 300", g(0, 5)), "# family\n  seed: [[A]]\n  ancestors: 0\n  descendants: 5\n  height: 300");
	const back = parseBlockOptions(withGenerations("seed: [[A]]\ndepth: 3", g(3, 1)), { depth: 3, height: 500, ancestors: 2, descendants: 2 });
	assert.deepEqual(back.generations, g(3, 1));
	assert.deepEqual(back.problems, []);
});

test("rewriteBody only touches a block that still holds the expected text", () => {
	const note = ["# Tree", "", "```lineage", "seed: [[A]]", "depth: 3", "```", "after"];
	const body = "seed: [[A]]\ndepth: 3";
	const next = "seed: [[A]]\nancestors: 1\ndescendants: 2";
	assert.deepEqual(rewriteBody(note, 2, 5, body, next), ["seed: [[A]]", "ancestors: 1", "descendants: 2"]);
	assert.deepEqual(rewriteBody(note, 2, 5, body + "\n", next), ["seed: [[A]]", "ancestors: 1", "descendants: 2"], "trailing blank line");
	assert.equal(rewriteBody(note, 2, 5, "seed: [[B]]\ndepth: 3", next), null, "edited since");
	assert.equal(rewriteBody(note, 1, 4, body, next), null, "lines moved");
	assert.equal(rewriteBody(note, 2, 9, body, next), null, "past the end");
	assert.equal(rewriteBody(["```python", "seed: [[A]]", "```"], 0, 2, "seed: [[A]]", next), null, "another language");
	assert.deepEqual(rewriteBody(["~~~ lineage", "seed: [[A]]", "~~~"], 0, 2, "seed: [[A]]", "x"), ["x"], "tilde fences");
});

test("rewriteBody keeps a callout's prefix on every line", () => {
	const note = ["> [!note] Family", "> ```lineage", "> seed: [[A]]", ">", "> depth: 2", "> ```"];
	assert.deepEqual(rewriteBody(note, 1, 5, "seed: [[A]]\n\ndepth: 2", "seed: [[A]]\n\nancestors: 1"), ["> seed: [[A]]", ">", "> ancestors: 1"]);
	assert.equal(rewriteBody(["> ```lineage", "seed: [[A]]", "> ```"], 0, 2, "seed: [[A]]", "x"), null, "line outside the callout");
});
