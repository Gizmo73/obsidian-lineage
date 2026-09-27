// Loads test-vault/ into a RelationshipStore the way the plugin does, minus Obsidian.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { basename, parseRecord, PropertyNames, RelationshipStore } from "../src/store";

export const DEFAULT_PROPS: PropertyNames = { mother: "Mother", father: "Father", spouse: "Spouse", born: "Born", died: "Died" };

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((f) => {
		const p = join(dir, f);
		if (f.startsWith(".")) return [];
		return statSync(p).isDirectory() ? walk(p) : p.endsWith(".md") ? [p] : [];
	});
}

export function loadVault(root = "test-vault") {
	const notes = walk(root).map((file) => {
		const text = readFileSync(file, "utf8");
		const m = /^---\n([\s\S]*?)\n---/.exec(text);
		const fm = m ? (parse(m[1]) ?? {}) : {};
		return { path: relative(root, file).split("\\").join("/"), fm };
	});
	const byName = new Map<string, string>();
	for (const n of notes) {
		byName.set(basename(n.path).toLowerCase(), n.path);
		byName.set(n.path.toLowerCase().replace(/\.md$/, ""), n.path);
		for (const a of (n.fm.aliases ?? []) as string[]) byName.set(String(a).toLowerCase(), n.path);
	}
	const resolve = (link: string) => {
		const p = byName.get(link.toLowerCase());
		return p ? { path: p } : null;
	};
	const store = new RelationshipStore();
	for (const n of notes) store.set(parseRecord(n.path, n.fm, DEFAULT_PROPS, resolve));
	return { store, resolve };
}
