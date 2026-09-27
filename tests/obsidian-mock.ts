// The slice of the Obsidian API that VaultIndex uses, for Node tests.
export class TFile {
	constructor(public path: string) {}
	get extension() {
		return this.path.split(".").pop() ?? "";
	}
	get basename() {
		return (this.path.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
	}
}

export function parseFrontMatterAliases(fm: any): string[] | null {
	const a = fm?.aliases ?? fm?.alias;
	if (!a) return null;
	return Array.isArray(a) ? a.map(String) : [String(a)];
}

/** Fake app: notes by path with frontmatter; resolves links by basename or path. */
export function fakeApp(notes: Record<string, Record<string, unknown>>) {
	const files = () => Object.keys(notes).map((p) => new TFile(p));
	return {
		vault: {
			getMarkdownFiles: files,
			getAbstractFileByPath: (p: string) => (p in notes ? new TFile(p) : null),
		},
		metadataCache: {
			getFileCache: (f: TFile) => ({ frontmatter: notes[f.path] }),
			getFirstLinkpathDest: (link: string) => {
				const l = link.toLowerCase();
				const hit = Object.keys(notes).find((p) => p.toLowerCase() === `${l}.md` || new TFile(p).basename.toLowerCase() === l);
				return hit ? new TFile(hit) : null;
			},
		},
	};
}
