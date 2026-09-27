import { App, PluginSettingTab, Setting } from "obsidian";
import type LineagePlugin from "./main";
import { PdfPageSize } from "./pdf";
import { PropertyNames } from "./store";

export interface LineageSettings extends PropertyNames {
	defaultDepth: number;
	defaultHeight: number;
	/** Blank means alongside the note that holds the code block. */
	exportFolder: string;
	pdfPageSize: PdfPageSize;
}

export const DEFAULT_SETTINGS: LineageSettings = {
	mother: "Mother",
	father: "Father",
	spouse: "Spouse",
	born: "Born",
	died: "Died",
	defaultDepth: 3,
	defaultHeight: 500,
	exportFolder: "",
	pdfPageSize: "fit",
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
		new Setting(containerEl)
			.setName("Default depth")
			.setDesc("Relationship hops from the seed when a block has no depth option.")
			.addText((t) =>
				t
					.setPlaceholder(String(DEFAULT_SETTINGS.defaultDepth))
					.setValue(String(this.plugin.settings.defaultDepth))
					.onChange(async (v) => {
						const n = parseInt(v, 10);
						this.plugin.settings.defaultDepth = Number.isFinite(n) && n >= 0 ? n : DEFAULT_SETTINGS.defaultDepth;
						await this.plugin.saveSettings(false);
					}),
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
