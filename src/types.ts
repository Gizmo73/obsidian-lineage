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
	/** Adoptive, foster or "on paper" parents (excluding self and the real parents). */
	raisedBy(id: PersonId): PersonId[];
	/** Notes whose Raised by points at this person. */
	raisedChildren(id: PersonId): PersonId[];
	/** Own Spouse entries plus notes whose Spouse points here (excluding self). */
	spouses(id: PersonId): PersonId[];
	/** Data problems recorded against this note (bad years, self references). */
	issues(id: PersonId): LineageWarning[];
	/** The marriage year this person's own note gives for that spouse, if any. */
	marriedYear(id: PersonId, spouse: PersonId): number | null;
}

/** Two declared spouses and their marriage year, when either note gives one. */
export type SpousePair = [PersonId, PersonId, number | null];

/** The part of the family graph selected for one code block. */
export interface Tree {
	seed: PersonId;
	persons: Map<PersonId, PersonInfo>;
	/** [parent, child] pairs, acyclic. */
	parentEdges: [PersonId, PersonId][];
	/** [raiser, child] pairs from Raised by. Acyclic together with parentEdges. */
	raisedEdges: [PersonId, PersonId][];
	/** Declared spouse pairs, each pair listed once. */
	spousePairs: SpousePair[];
	warnings: LineageWarning[];
}

export function missingId(linkText: string): PersonId {
	return "missing:" + linkText.trim().toLowerCase();
}

export function isMissingId(id: PersonId): boolean {
	return id.startsWith("missing:");
}
