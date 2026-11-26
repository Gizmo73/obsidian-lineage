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
