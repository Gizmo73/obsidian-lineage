import { debounce, HoverParent, HoverPopover, MarkdownPostProcessorContext, MarkdownRenderChild } from "obsidian";
import { wireLinks } from "./links";
import type LineagePlugin from "./main";
import { marriagesOf } from "./marriages";

/** Inline code that lists the note's marriages, e.g. in a table cell. */
export const MARRIED_CODE = "lineage-married";

/** Replace each `lineage-married` inline code under `el` with a live list of marriages. */
export function renderMarriedCodes(plugin: LineagePlugin, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
	for (const code of Array.from(el.querySelectorAll("code"))) {
		if (code.parentElement?.tagName === "PRE" || code.textContent?.trim() !== MARRIED_CODE) continue;
		const span = code.ownerDocument.createElement("span");
		span.className = "lineage-married-list";
		code.replaceWith(span);
		ctx.addChild(new MarriedList(plugin, span, ctx.sourcePath));
	}
}

/** "1456 to A person", one line per marriage. Redraws when relationships change. */
class MarriedList extends MarkdownRenderChild implements HoverParent {
	hoverPopover: HoverPopover | null = null;
	private refreshSoon = debounce(() => this.render(), 300, true);

	constructor(
		private plugin: LineagePlugin,
		containerEl: HTMLElement,
		private sourcePath: string,
	) {
		super(containerEl);
	}

	onload(): void {
		// Our links handle themselves: keep Live Preview from opening the table
		// cell for editing, and Obsidian from previewing the same link twice.
		for (const type of ["click", "auxclick", "mousedown", "pointerdown", "mouseover"] as const) {
			this.registerDomEvent(this.containerEl, type, (e) => e.stopPropagation());
		}
		wireLinks(this.plugin.app, this.containerEl, this, () => this.sourcePath);
		this.render();
		this.register(this.plugin.index.subscribe(() => this.refreshSoon()));
	}

	onunload(): void {
		this.refreshSoon.cancel();
	}

	private render(): void {
		const el = this.containerEl;
		el.empty();
		const { index } = this.plugin;
		index.ensureBuilt();
		marriagesOf(index.store, this.sourcePath).forEach((m, i) => {
			if (i) el.createEl("br");
			el.appendText(`${m.year ?? "?"} to `);
			if (m.path) el.createEl("a", { cls: "internal-link", text: m.name, href: m.path, attr: { "data-path": m.path } });
			else el.createSpan({ cls: "lineage-married-missing", text: m.name });
		});
	}
}
