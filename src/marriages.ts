import { GraphSource, PersonId } from "./types";

export interface Marriage {
	spouse: PersonId;
	name: string;
	/** Null when the spouse's note does not exist. */
	path: string | null;
	year: number | null;
}

/**
 * Everyone this person married, from either note's Spouse, oldest marriage
 * first and unknown years last. The year comes from this person's note, or
 * from the spouse's if this one gives none, as in the tree.
 */
export function marriagesOf(source: GraphSource, id: PersonId): Marriage[] {
	return source
		.spouses(id)
		.map((spouse) => {
			const { name, path } = source.info(spouse);
			return { spouse, name, path, year: source.marriedYear(id, spouse) ?? source.marriedYear(spouse, id) };
		})
		.sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || a.name.localeCompare(b.name));
}
