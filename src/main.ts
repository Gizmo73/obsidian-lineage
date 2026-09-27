import { Plugin } from "obsidian";
import { HOVER_SOURCE, LineageBlock } from "./block";
import { DEFAULT_SETTINGS, LineageSettings, LineageSettingTab } from "./settings";
import { VaultIndex } from "./vault-index";

export default class LineagePlugin extends Plugin {
	settings: LineageSettings = { ...DEFAULT_SETTINGS };
	index!: VaultIndex;
	private settingsListeners = new Set<() => void>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.index = new VaultIndex(this.app, () => this.settings);

		this.registerEvent(this.app.metadataCache.on("changed", (file, _data, cache) => this.index.onMetadataChanged(file, cache)));
		this.registerEvent(this.app.metadataCache.on("resolved", () => this.index.onResolved()));
		this.registerEvent(this.app.vault.on("rename", () => this.index.invalidate()));
		this.registerEvent(this.app.vault.on("delete", () => this.index.invalidate()));

		this.registerHoverLinkSource(HOVER_SOURCE, { display: "Lineage family trees", defaultMod: false });
		this.registerMarkdownCodeBlockProcessor("lineage", (source, el, ctx) => {
			ctx.addChild(new LineageBlock(this, el, source, ctx));
		});
		this.addSettingTab(new LineageSettingTab(this.app, this));
	}

	/** Open trees re-render when settings change. Returns an unsubscribe function. */
	onSettingsChange(fn: () => void): () => void {
		this.settingsListeners.add(fn);
		return () => this.settingsListeners.delete(fn);
	}

	async loadSettings(): Promise<void> {
		this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) ?? {}) };
	}

	/** Pass true when property names changed, so the index is rebuilt. */
	async saveSettings(reindex: boolean): Promise<void> {
		await this.saveData(this.settings);
		if (reindex) this.index.invalidate();
		else this.settingsListeners.forEach((fn) => fn());
	}
}
