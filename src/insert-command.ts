import { App, Editor, FuzzyMatch, FuzzySuggestModal, normalizePath, Notice, renderResults, SuggestModal, TFile } from "obsidian";
import { blockInsertion, countChoices, formatBlock, seedCandidates } from "./insert";
import type LineagePlugin from "./main";

/** Pick a seed note, then ancestors, then descendants, and insert a lineage block at the cursor. */
export function insertFamilyTree(plugin: LineagePlugin, editor: Editor, sourcePath: string): void {
	const { app, settings } = plugin;
	const folder = settings.seedFolder ? normalizePath(settings.seedFolder) : "";
	const files = seedCandidates(app.vault.getMarkdownFiles(), folder, sourcePath);
	if (!files.length) {
		new Notice(folder ? `No notes found in "${folder}". Check the people folder in Lineage settings.` : "No notes to pick from.");
		return;
	}
	new SeedModal(app, files, (seed) => {
		new CountModal(app, ANCESTORS, settings.defaultAncestors, (ancestors) => {
			new CountModal(app, DESCENDANTS, settings.defaultDescendants, (descendants) => {
				const linktext = app.metadataCache.fileToLinktext(seed, sourcePath, true);
				const from = editor.getCursor("from");
				const block = formatBlock(linktext, { ancestors, descendants });
				const text = blockInsertion(block, editor.getLine(from.line).slice(0, from.ch));
				editor.replaceRange(text, from, editor.getCursor("to"));
				editor.setCursor(editor.offsetToPos(editor.posToOffset(from) + text.length));
				editor.focus();
			}).open();
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

interface CountKind {
	placeholder: string;
	label: (n: number) => string;
	/** What a count brings in, for the first few. */
	notes: string[];
}

const ANCESTORS: CountKind = {
	placeholder: "Ancestors: generations up from the seed",
	label: (n) => `${generations(n)} up`,
	notes: ["Nobody above the seed", "Parents and siblings", "Grandparents, aunts, uncles and cousins", "Great-grandparents and second cousins"],
};

const DESCENDANTS: CountKind = {
	placeholder: "Descendants: generations down from the seed",
	label: (n) => `${generations(n)} down`,
	notes: ["Nobody below the seed", "Children", "Grandchildren", "Great-grandchildren"],
};

function generations(n: number): string {
	return n === 1 ? "1 generation" : `${n} generations`;
}

class CountModal extends SuggestModal<number> {
	constructor(
		app: App,
		private kind: CountKind,
		private defaultCount: number,
		private onPick: (n: number) => void,
	) {
		super(app);
		this.setPlaceholder(kind.placeholder);
		this.emptyStateText = "Type a whole number, 0 or more.";
		this.setInstructions([
			{ command: "↵", purpose: "choose" },
			{ command: "esc", purpose: "cancel" },
		]);
	}

	getSuggestions(query: string): number[] {
		return countChoices(query, this.defaultCount);
	}

	renderSuggestion(n: number, el: HTMLElement): void {
		const title = el.createDiv({ text: this.kind.label(n) });
		if (n === this.defaultCount) title.createSpan({ cls: "lineage-suggest-flair", text: "default" });
		const note = this.kind.notes[n];
		if (note) el.createDiv({ cls: "lineage-suggest-note", text: note });
	}

	onChooseSuggestion(n: number): void {
		this.onPick(n);
	}
}
