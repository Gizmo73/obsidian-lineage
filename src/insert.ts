// Pure helpers for the Insert family tree command, kept free of Obsidian runtime imports so they run in Node tests.

/** Depths offered before anything is typed. */
export const PRESET_DEPTHS = [0, 1, 2, 3, 4, 5, 6];

/** Whether a vault path is inside `folder` or one of its subfolders. A blank folder means the whole vault. */
export function inFolder(path: string, folder: string): boolean {
	const f = folder.replace(/^\/+|\/+$/g, "").toLowerCase();
	return !f || path.toLowerCase().startsWith(`${f}/`);
}

/**
 * Notes to offer as seeds: those in `folder`, sorted by name, with the note
 * being edited first so its own tree is one keypress away.
 */
export function seedCandidates<T extends { path: string; basename: string }>(files: T[], folder: string, currentPath?: string): T[] {
	const list = files
		.filter((f) => inFolder(f.path, folder))
		.sort((a, b) => a.basename.localeCompare(b.basename) || a.path.localeCompare(b.path));
	const i = list.findIndex((f) => f.path === currentPath);
	if (i > 0) list.unshift(...list.splice(i, 1));
	return list;
}

/**
 * Depths to list for what has been typed. Nothing typed gives the presets
 * with the default first, so Enter picks it; a whole number gives just that.
 */
export function depthChoices(query: string, defaultDepth: number): number[] {
	const q = query.trim();
	if (q) return /^\d+$/.test(q) ? [parseInt(q, 10)] : [];
	return [defaultDepth, ...PRESET_DEPTHS.filter((d) => d !== defaultDepth)];
}

/** The lineage block for a seed and depth. `seedLinktext` is what goes inside the [[ ]]. */
export function formatBlock(seedLinktext: string, depth: number): string {
	return ["```lineage", `seed: [[${seedLinktext}]]`, `depth: ${depth}`, "```"].join("\n");
}

/**
 * Text to insert at the cursor so the fences start their own lines: a line
 * break first if anything is before the cursor, and one after the block.
 */
export function blockInsertion(block: string, textBeforeCursor: string): string {
	return `${textBeforeCursor ? "\n" : ""}${block}\n`;
}
