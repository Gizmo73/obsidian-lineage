import { App, Editor, FuzzyMatch, FuzzySuggestModal, normalizePath, Notice, renderResults, SuggestModal, TFile } from "obsidian";
import { blockInsertion, depthChoices, formatBlock, seedCandidates } from "./insert";
import type LineagePlugin from "./main";

/** Pick a seed note, then a depth, then insert a lineage block at the cursor. */
export function insertFamilyTree(plugin: LineagePlugin, editor: Editor, sourcePath: string): void {
	const { app, settings } = plugin;
	const folder = settings.seedFolder ? normalizePath(settings.seedFolder) : "";
	const files = seedCandidates(app.vault.getMarkdownFiles(), folder, sourcePath);
	if (!files.length) {
		new Notice(folder ? `No notes found in "${folder}". Check the people folder in Lineage settings.` : "No notes to pick from.");
		return;
	}
	new SeedModal(app, files, (seed) => {
		new DepthModal(app, settings.defaultDepth, (depth) => {
			const linktext = app.metadataCache.fileToLinktext(seed, sourcePath, true);
			const from = editor.getCursor("from");
			const text = blockInsertion(formatBlock(linktext, depth), editor.getLine(from.line).slice(0, from.ch));
			editor.replaceRange(text, from, editor.getCursor("to"));
			editor.setCursor(editor.offsetToPos(editor.posToOffset(from) + text.length));
			editor.focus();
		}).open();
	}).open();
}

class SeedModal extends FuzzySuggestModal<TFile> {
	private duplicates: Set<string>;

	constructor(
		app: App,
		private files: TFile[],
		private onPick: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder("Seed: the person the tree starts from");
		this.emptyStateText = "No matching notes.";
		const seen = new Set<string>();
		this.duplicates = new Set();
		for (const f of files) {
			const key = f.basename.toLowerCase();
			if (seen.has(key)) this.duplicates.add(key);
			seen.add(key);
		}
	}

	getItems(): TFile[] {
		return this.files;
	}

	getItemText(file: TFile): string {
		return file.basename;
	}

	renderSuggestion(item: FuzzyMatch<TFile>, el: HTMLElement): void {
		renderResults(el.createDiv(), item.item.basename, item.match);
		// Only show the folder when two notes share a name.
		if (this.duplicates.has(item.item.basename.toLowerCase()) && item.item.parent && !item.item.parent.isRoot()) {
			el.createDiv({ cls: "lineage-suggest-note", text: item.item.parent.path });
		}
	}

	onChooseItem(file: TFile): void {
		this.onPick(file);
	}
}

class DepthModal extends SuggestModal<number> {
	constructor(
		app: App,
		private defaultDepth: number,
		private onPick: (depth: number) => void,
	) {
		super(app);
		this.setPlaceholder("Depth: pick one or type a number");
		this.emptyStateText = "Type a whole number, 0 or more.";
		this.setInstructions([
			{ command: "↵", purpose: "insert" },
			{ command: "esc", purpose: "cancel" },
		]);
	}

	getSuggestions(query: string): number[] {
		return depthChoices(query, this.defaultDepth);
	}

	renderSuggestion(depth: number, el: HTMLElement): void {
		const title = el.createDiv({ text: `Depth ${depth}` });
		if (depth === this.defaultDepth) title.createSpan({ cls: "lineage-suggest-flair", text: "default" });
		const note = depth === 0 ? "The seed only" : depth === 1 ? "Parents, children and spouses" : null;
		if (note) el.createDiv({ cls: "lineage-suggest-note", text: note });
	}

	onChooseSuggestion(depth: number): void {
		this.onPick(depth);
	}
}
