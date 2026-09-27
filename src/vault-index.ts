import { App, CachedMetadata, parseFrontMatterAliases, TFile } from "obsidian";
import { parseRecord, PropertyNames, recordSignature, RelationshipStore } from "./store";

/**
 * Keeps a RelationshipStore in step with the vault. Built lazily on first
 * use; frontmatter edits update one record, anything structural (new note,
 * rename, delete, alias change) marks the whole index for a rebuild.
 */
export class VaultIndex {
	readonly store = new RelationshipStore();
	private built = false;
	private startupResolved = false;
	private signatures = new Map<string, string>();
	private aliasesByPath = new Map<string, string[]>();
	private pathByAlias = new Map<string, string>();
	private listeners = new Set<() => void>();

	constructor(
		private app: App,
		private props: () => PropertyNames,
	) {}

	/** Called when index contents change. Returns an unsubscribe function. */
	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	ensureBuilt(): void {
		if (this.built) return;
		this.store.clear();
		this.signatures.clear();
		this.aliasesByPath.clear();
		this.pathByAlias.clear();
		const files = this.app.vault.getMarkdownFiles();
		// Aliases first, so links to an alias resolve during parsing.
		for (const f of files) this.indexAliases(f, this.app.metadataCache.getFileCache(f));
		for (const f of files) this.indexRecord(f, this.app.metadataCache.getFileCache(f));
		this.built = true;
	}

	/** Mark for a full rebuild on next use and tell open trees. */
	invalidate(): void {
		this.built = false;
		this.notify();
	}

	onMetadataChanged(file: TFile, cache: CachedMetadata): void {
		if (!this.built || file.extension !== "md") return;
		if (!this.store.get(file.path)) {
			// A new note may resolve links that were missing until now.
			this.invalidate();
			return;
		}
		const aliases = aliasList(cache);
		if (aliases.join("\u0000") !== (this.aliasesByPath.get(file.path) ?? []).join("\u0000")) {
			this.invalidate();
			return;
		}
		if (this.indexRecord(file, cache)) this.notify();
	}

	/**
	 * The metadata cache may still be filling when the first trees render at
	 * startup; rebuild once it reports everything resolved.
	 */
	onResolved(): void {
		if (this.startupResolved) return;
		this.startupResolved = true;
		if (this.built) this.invalidate();
	}

	/** Resolve link text the way a wikilink would, falling back to aliases. */
	resolve(linkpath: string, sourcePath: string): TFile | null {
		const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
		if (file && file.extension === "md") return file;
		const byAlias = this.pathByAlias.get(linkpath.trim().toLowerCase());
		if (byAlias) {
			const f = this.app.vault.getAbstractFileByPath(byAlias);
			if (f instanceof TFile) return f;
		}
		return null;
	}

	private indexAliases(file: TFile, cache: CachedMetadata | null) {
		const aliases = aliasList(cache);
		this.aliasesByPath.set(file.path, aliases);
		for (const a of aliases) if (!this.pathByAlias.has(a)) this.pathByAlias.set(a, file.path);
	}

	/** Returns true when the record's relationship data changed. */
	private indexRecord(file: TFile, cache: CachedMetadata | null): boolean {
		const record = parseRecord(file.path, cache?.frontmatter, this.props(), (link, src) => this.resolve(link, src));
		const sig = recordSignature(record);
		if (this.signatures.get(file.path) === sig) return false;
		this.signatures.set(file.path, sig);
		this.store.set(record);
		return true;
	}

	private notify() {
		for (const fn of this.listeners) fn();
	}
}

function aliasList(cache: CachedMetadata | null): string[] {
	return (parseFrontMatterAliases(cache?.frontmatter ?? null) ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean);
}
