import { App, PluginSettingTab, Setting } from "obsidian";
import type LineagePlugin from "./main";
import { PdfPageSize } from "./pdf";
import { PropertyNames } from "./store";

export interface LineageSettings extends PropertyNames {
	defaultDepth: number;
	defaultHeight: number;
	defaultAncestors: number;
	defaultDescendants: number;
	/** Blank means alongside the note that holds the code block. */
	exportFolder: string;
	pdfPageSize: PdfPageSize;
	/** Where the Insert family tree command looks for seed notes. Blank means the whole vault. */
	seedFolder: string;
}

export const DEFAULT_SETTINGS: LineageSettings = {
	mother: "Mother",
	father: "Father",
	spouse: "Spouse",
	married: "Married",
	raisedBy: "Raised by",
	born: "Born",
	died: "Died",
	defaultDepth: 3,
	defaultHeight: 500,
	defaultAncestors: 2,
	defaultDescendants: 2,
	exportFolder: "",
	pdfPageSize: "fit",
	seedFolder: "",
};

export class LineageSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: LineagePlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Properties").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Frontmatter property names to read. Matching ignores case.",
		});
		const props: [keyof PropertyNames, string, string][] = [
			["mother", "Mother", "A single link to the mother's note."],
			["father", "Father", "A single link to the father's note."],
			["spouse", "Spouse", "A link, or a list of links for remarriage."],
			[
				"married",
				"Married",
				"Year of marriage. For several spouses, a list of years in the same order as Spouse; use ? for an unknown year.",
			],
			[
				"raisedBy",
				"Raised by",
				"A link, or a list of links, to whoever raised this person: adoptive, foster or on-paper parents. Drawn as a dotted line.",
			],
			["born", "Born", "Year of birth, as a whole number."],
			["died", "Died", "Year of death, as a whole number."],
		];
		for (const [key, name, desc] of props) {
			new Setting(containerEl)
				.setName(`${name} property`)
				.setDesc(desc)
				.addText((t) =>
					t
						.setPlaceholder(DEFAULT_SETTINGS[key])
						.setValue(this.plugin.settings[key])
						.onChange(async (v) => {
							this.plugin.settings[key] = v.trim() || DEFAULT_SETTINGS[key];
							await this.plugin.saveSettings(true);
						}),
				);
		}

		new Setting(containerEl).setName("View").setHeading();
		const count = (key: "defaultDepth" | "defaultAncestors" | "defaultDescendants", name: string, desc: string) =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((t) =>
					t
						.setPlaceholder(String(DEFAULT_SETTINGS[key]))
						.setValue(String(this.plugin.settings[key]))
						.onChange(async (v) => {
							const n = parseInt(v, 10);
							this.plugin.settings[key] = Number.isFinite(n) && n >= 0 ? n : DEFAULT_SETTINGS[key];
							await this.plugin.saveSettings(false);
						}),
				);
		count(
			"defaultAncestors",
			"Default ancestors",
			"Generations above the seed when a block gives descendants but not ancestors. Also the first choice in Insert family tree.",
		);
		count(
			"defaultDescendants",
			"Default descendants",
			"Generations below the seed when a block gives ancestors but not descendants. Also the first choice in Insert family tree.",
		);
		count(
			"defaultDepth",
			"Default depth",
			"Relationship hops from the seed, in any direction, for blocks with none of depth, ancestors or descendants.",
		);
		new Setting(containerEl)
			.setName("Default view height")
			.setDesc("Height in pixels when a block has no height option.")
			.addText((t) =>
				t
					.setPlaceholder(String(DEFAULT_SETTINGS.defaultHeight))
					.setValue(String(this.plugin.settings.defaultHeight))
					.onChange(async (v) => {
						const n = parseInt(v, 10);
						this.plugin.settings.defaultHeight = Number.isFinite(n) && n >= 100 ? n : DEFAULT_SETTINGS.defaultHeight;
						await this.plugin.saveSettings(false);
					}),
			);

		new Setting(containerEl).setName("Insert command").setHeading();
		new Setting(containerEl)
			.setName("People folder")
			.setDesc("Insert family tree lists seed notes from this folder and its subfolders. Leave blank to list every note.")
			.addText((t) =>
				t
					.setPlaceholder("Whole vault")
					.setValue(this.plugin.settings.seedFolder)
					.onChange(async (v) => {
						this.plugin.settings.seedFolder = v.trim();
						await this.plugin.saveSettings(false);
					}),
			);

		new Setting(containerEl).setName("Export").setHeading();
		new Setting(containerEl)
			.setName("Export folder")
			.setDesc("Vault folder for exported PDF and SVG files. Leave blank to save next to the note.")
			.addText((t) =>
				t
					.setPlaceholder("Same folder as the note")
					.setValue(this.plugin.settings.exportFolder)
					.onChange(async (v) => {
						this.plugin.settings.exportFolder = v.trim();
						await this.plugin.saveSettings(false);
					}),
			);
		new Setting(containerEl)
			.setName("PDF page size")
			.setDesc("Fit to tree makes one page exactly the size of the tree. A4 and A3 scale the tree to fit one landscape page.")
			.addDropdown((d) =>
				d
					.addOptions({ fit: "Fit to tree", a4: "A4 landscape", a3: "A3 landscape" })
					.setValue(this.plugin.settings.pdfPageSize)
					.onChange(async (v) => {
						this.plugin.settings.pdfPageSize = v as PdfPageSize;
						await this.plugin.saveSettings(false);
					}),
			);
	}
}
