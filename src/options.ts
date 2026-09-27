export interface BlockOptions {
	seed: string | null;
	depth: number;
	height: number;
	problems: string[];
}

/** Parse the `key: value` lines of a lineage block. */
export function parseBlockOptions(source: string, defaults: { depth: number; height: number }): BlockOptions {
	const opts: BlockOptions = { seed: null, depth: defaults.depth, height: defaults.height, problems: [] };
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
		} else if (key === "depth" || key === "height") {
			const n = Number(value);
			const min = key === "depth" ? 0 : 100;
			if (!Number.isInteger(n) || n < min) {
				opts.problems.push(`${key} must be a whole number of at least ${min}. Using ${opts[key]}.`);
			} else {
				opts[key] = n;
			}
		} else {
			opts.problems.push(`Unknown option "${m[1]}".`);
		}
	}
	return opts;
}
