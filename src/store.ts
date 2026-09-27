import { GraphSource, LineageWarning, missingId, PersonId, PersonInfo } from "./types";

export interface PropertyNames {
	mother: string;
	father: string;
	spouse: string;
	born: string;
	died: string;
}

export interface PersonRecord {
	path: string;
	name: string;
	mother: PersonId | null;
	father: PersonId | null;
	spouses: PersonId[];
	born: number | null;
	died: number | null;
	issues: LineageWarning[];
	/** Display names for the missing notes this record links to. */
	missingNames: [PersonId, string][];
}

/** Resolves link text to a note; null when no such note exists. */
export type Resolver = (linkpath: string, sourcePath: string) => { path: string } | null;

/** Case-insensitive frontmatter lookup. */
export function getProp(fm: Record<string, unknown> | undefined, key: string): unknown {
	if (!fm) return undefined;
	if (key in fm) return fm[key];
	const lower = key.toLowerCase();
	for (const k of Object.keys(fm)) if (k.toLowerCase() === lower) return fm[k];
	return undefined;
}

/**
 * Pull wikilink targets out of a frontmatter value. Plain text is ignored.
 * Also accepts the common unquoted mistake `Mother: [[X]]`, which YAML reads
 * as a nested list ["X"].
 */
export function extractLinkTexts(value: unknown): string[] {
	const out: string[] = [];
	const visit = (v: unknown, nested: boolean) => {
		if (typeof v === "string") {
			const re = /\[\[([^\]]+?)\]\]/g;
			let m: RegExpExecArray | null;
			let found = false;
			while ((m = re.exec(v))) {
				found = true;
				const target = m[1].split("|")[0].split("#")[0].trim();
				if (target) out.push(target);
			}
			if (!found && nested && v.trim()) out.push(v.split("|")[0].split("#")[0].trim());
		} else if (Array.isArray(v)) {
			// [[X]] unquoted parses as [["X"]]: an array whose only item is an array of one string.
			if (v.length === 1 && Array.isArray(v[0]) && v[0].length === 1 && typeof v[0][0] === "string") {
				visit(v[0][0], true);
			} else {
				for (const item of v) visit(item, nested);
			}
		}
	};
	visit(value, false);
	return out;
}

/** Returns the year, null when absent, or "bad" when present but not an integer. */
export function parseYear(value: unknown): number | null | "bad" {
	if (value === undefined || value === null || value === "") return null;
	if (typeof value === "number") return Number.isInteger(value) ? value : "bad";
	if (typeof value === "string" && /^\s*-?\d+\s*$/.test(value)) return parseInt(value, 10);
	return "bad";
}

export function basename(path: string): string {
	const file = path.split("/").pop() ?? path;
	return file.replace(/\.md$/i, "");
}

export function parseRecord(
	path: string,
	fm: Record<string, unknown> | undefined,
	props: PropertyNames,
	resolve: Resolver,
): PersonRecord {
	const name = basename(path);
	const issues: LineageWarning[] = [];
	const missingNames: [PersonId, string][] = [];
	const warn = (message: string) => issues.push({ message, path, name });

	const toId = (text: string, role: string): PersonId | null => {
		const target = resolve(text, path);
		if (!target) {
			const id = missingId(text);
			missingNames.push([id, basename(text)]);
			return id;
		}
		if (target.path === path) {
			warn(`${name} lists themselves as ${role}. Ignored.`);
			return null;
		}
		return target.path;
	};

	const single = (key: string, role: string): PersonId | null => {
		const texts = extractLinkTexts(getProp(fm, key));
		if (texts.length > 1) warn(`${name} has more than one ${role} link. Only the first is used.`);
		return texts.length ? toId(texts[0], role) : null;
	};

	const mother = single(props.mother, "mother");
	const father = single(props.father, "father");
	const spouses: PersonId[] = [];
	for (const t of extractLinkTexts(getProp(fm, props.spouse))) {
		const id = toId(t, "spouse");
		if (id && !spouses.includes(id)) spouses.push(id);
	}

	const year = (key: string): number | null => {
		const raw = getProp(fm, key);
		const y = parseYear(raw);
		if (y === "bad") {
			warn(`${key} value "${String(raw)}" is not a whole year. Treated as unknown.`);
			return null;
		}
		return y;
	};

	return {
		path,
		name,
		mother,
		father: father === mother ? null : father,
		spouses,
		born: year(props.born),
		died: year(props.died),
		issues,
		missingNames,
	};
}

/** Relationship data comparable across updates, to skip redraws for unrelated edits. */
export function recordSignature(r: PersonRecord): string {
	return JSON.stringify([r.mother, r.father, r.spouses, r.born, r.died, r.issues.map((i) => i.message)]);
}

/** In-memory index with reverse lookups for children and spouses. */
export class RelationshipStore implements GraphSource {
	private records = new Map<string, PersonRecord>();
	private childrenRev = new Map<PersonId, Set<string>>();
	private spouseRev = new Map<PersonId, Set<string>>();
	private missingNames = new Map<PersonId, string>();

	clear(): void {
		this.records.clear();
		this.childrenRev.clear();
		this.spouseRev.clear();
		this.missingNames.clear();
	}

	get(path: string): PersonRecord | undefined {
		return this.records.get(path);
	}

	set(record: PersonRecord): void {
		this.remove(record.path);
		this.records.set(record.path, record);
		for (const p of [record.mother, record.father]) if (p) addTo(this.childrenRev, p, record.path);
		for (const s of record.spouses) addTo(this.spouseRev, s, record.path);
		for (const [id, name] of record.missingNames) this.missingNames.set(id, name);
	}

	remove(path: string): void {
		const old = this.records.get(path);
		if (!old) return;
		this.records.delete(path);
		for (const p of [old.mother, old.father]) if (p) this.childrenRev.get(p)?.delete(path);
		for (const s of old.spouses) this.spouseRev.get(s)?.delete(path);
	}

	info(id: PersonId): PersonInfo {
		const r = this.records.get(id);
		if (r) return { id, name: r.name, path: r.path, born: r.born, died: r.died };
		if (id.startsWith("missing:")) {
			return { id, name: this.missingNames.get(id) ?? id.slice(8), path: null, born: null, died: null };
		}
		return { id, name: basename(id), path: id, born: null, died: null };
	}

	parents(id: PersonId): PersonId[] {
		const r = this.records.get(id);
		if (!r) return [];
		return [r.mother, r.father].filter((p): p is PersonId => !!p);
	}

	children(id: PersonId): PersonId[] {
		return Array.from(this.childrenRev.get(id) ?? []);
	}

	spouses(id: PersonId): PersonId[] {
		const out = new Set(this.records.get(id)?.spouses ?? []);
		for (const s of this.spouseRev.get(id) ?? []) if (s !== id) out.add(s);
		return Array.from(out);
	}

	issues(id: PersonId): LineageWarning[] {
		return this.records.get(id)?.issues ?? [];
	}
}

function addTo(map: Map<PersonId, Set<string>>, key: PersonId, value: string) {
	let s = map.get(key);
	if (!s) map.set(key, (s = new Set()));
	s.add(value);
}
