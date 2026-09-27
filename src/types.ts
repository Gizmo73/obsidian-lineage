/** A problem found in the data, shown in the warnings panel. */
export interface LineageWarning {
	message: string;
	/** Path of the note the warning is about, when there is one. */
	path?: string;
	/** Display name for the linked note. */
	name?: string;
}

/**
 * Person ids are vault paths for real notes, and `missing:<link text>` for
 * links that point at notes that do not exist.
 */
export type PersonId = string;

export interface PersonInfo {
	id: PersonId;
	name: string;
	/** Vault path, or null when the note does not exist. */
	path: string | null;
	born: number | null;
	died: number | null;
}

/** What traversal needs from the relationship index. Kept abstract so it can be tested without Obsidian. */
export interface GraphSource {
	info(id: PersonId): PersonInfo;
	/** Mother and father ids (excluding self references). */
	parents(id: PersonId): PersonId[];
	/** Notes whose Mother or Father points at this person. */
	children(id: PersonId): PersonId[];
	/** Own Spouse entries plus notes whose Spouse points here (excluding self). */
	spouses(id: PersonId): PersonId[];
	/** Data problems recorded against this note (bad years, self references). */
	issues(id: PersonId): LineageWarning[];
}

/** The part of the family graph selected for one code block. */
export interface Tree {
	seed: PersonId;
	persons: Map<PersonId, PersonInfo>;
	/** [parent, child] pairs, acyclic. */
	parentEdges: [PersonId, PersonId][];
	/** Declared spouse pairs, each pair listed once. */
	spousePairs: [PersonId, PersonId][];
	warnings: LineageWarning[];
}

export function missingId(linkText: string): PersonId {
	return "missing:" + linkText.trim().toLowerCase();
}

export function isMissingId(id: PersonId): boolean {
	return id.startsWith("missing:");
}
