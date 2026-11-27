import type { Generations } from "./graph";

export interface BlockOptions {
	seed: string | null;
	depth: number;
	height: number;
	/** Set when the block gives ancestors or descendants; the tree then counts generations, not hops. */
	generations: Generations | null;
	problems: string[];
}

export interface BlockDefaults {
	depth: number;
	height: number;
	ancestors: number;
	descendants: number;
}

const MINIMUM = { depth: 0, height: 100, ancestors: 0, descendants: 0 };
type NumberKey = keyof typeof MINIMUM;

/** Parse the `key: value` lines of a lineage block. */
export function parseBlockOptions(source: string, defaults: BlockDefaults): BlockOptions {
	const opts: BlockOptions = { seed: null, depth: defaults.depth, height: defaults.height, generations: null, problems: [] };
	const given: Partial<Record<NumberKey, number>> = {};
	for (const raw of source.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const m = /^([A-Za-z]+)\s*:\s*(.*)$/.exec(line);
		if (!m) {
			opts.problems.push(`Could not read the line "${line}".`);
			continue;
		}
		const key = m[1].toLowerCase();
		const value = m[2].trim().replace(/^["']|["']$/g, "");
		if (key === "seed") {
			const link = /\[\[([^\]]+)\]\]/.exec(value);
			const text = (link ? link[1] : value).split("|")[0].split("#")[0].trim();
			opts.seed = text || null;
		} else if (key in MINIMUM) {
			const k = key as NumberKey;
			const n = Number(value);
			if (!Number.isInteger(n) || n < MINIMUM[k]) {
				opts.problems.push(`${k} must be a whole number of at least ${MINIMUM[k]}. Using ${defaults[k]}.`);
				given[k] = defaults[k];
			} else {
				given[k] = n;
			}
		} else {
			opts.problems.push(`Unknown option "${m[1]}".`);
		}
	}
	if (given.depth !== undefined) opts.depth = given.depth;
	if (given.height !== undefined) opts.height = given.height;
	if (given.ancestors !== undefined || given.descendants !== undefined) {
		opts.generations = {
			ancestors: given.ancestors ?? defaults.ancestors,
			descendants: given.descendants ?? defaults.descendants,
		};
		if (given.depth !== undefined) opts.problems.push("depth is ignored when ancestors or descendants is given.");
	}
	return opts;
}

const LIMIT_KEY = /^(\s*)(depth|ancestors|descendants)\s*:/i;

/**
 * The block's source with ancestors and descendants set, and any depth line
 * dropped. Other lines keep their order. The two lines go where the first
 * depth, ancestors or descendants line was, or else straight after the seed.
 */
export function withGenerations(source: string, { ancestors, descendants }: Generations): string {
	const out: string[] = [];
	let at = -1;
	let indent = "";
	for (const line of source.split("\n")) {
		const m = LIMIT_KEY.exec(line);
		if (!m) {
			out.push(line);
			continue;
		}
		if (at < 0) {
			at = out.length;
			indent = m[1];
		}
	}
	if (at < 0) {
		const seed = out.findIndex((l) => /^\s*seed\s*:/i.test(l));
		at = seed >= 0 ? seed + 1 : out.length;
		indent = seed >= 0 ? (/^\s*/.exec(out[seed]) as RegExpExecArray)[0] : "";
	}
	out.splice(at, 0, `${indent}ancestors: ${ancestors}`, `${indent}descendants: ${descendants}`);
	return out.join("\n");
}

/**
 * The note lines to put between a lineage block's fences, or null if the
 * note no longer holds `oldBody` there. `start` and `end` are the fence lines.
 * A block inside a callout keeps its "> " prefix on every line.
 */
export function rewriteBody(lines: string[], start: number, end: number, oldBody: string, newBody: string): string[] | null {
	if (start < 0 || end <= start || end >= lines.length) return null;
	const open = /^([\s>]*)(`{3,}|~{3,})\s*lineage\s*$/i.exec(lines[start]);
	if (!open) return null;
	const [, prefix, fence] = open;
	const strip = (line: string): string | null => {
		if (line.startsWith(prefix)) return line.slice(prefix.length);
		return line.trimEnd() === prefix.trimEnd() ? "" : null;
	};
	const close = strip(lines[end]);
	if (close === null || !close.trim().startsWith(fence)) return null;

	const tidy = (ls: string[]) => {
		const t = ls.map((l) => l.trimEnd());
		while (t.length && !t[t.length - 1]) t.pop();
		return t.join("\n");
	};
	const current = lines.slice(start + 1, end).map(strip);
	if (current.some((l) => l === null) || tidy(current as string[]) !== tidy(oldBody.split("\n"))) return null;
	return newBody.split("\n").map((l) => (l ? prefix + l : prefix.trimEnd()));
}
