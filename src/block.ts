import { debounce, HoverParent, HoverPopover, Keymap, MarkdownPostProcessorContext, MarkdownRenderChild, setIcon } from "obsidian";
import { exportTree } from "./export";
import { buildTree } from "./graph";
import { Layout, layoutTree, Measure, METRICS } from "./layout";
import type LineagePlugin from "./main";
import { PanZoom, ViewState } from "./panzoom";
import { buildViewSvg } from "./svg";
import { parseBlockOptions } from "./options";
import { LineageWarning } from "./types";

export const HOVER_SOURCE = "lineage-family-tree";
const LARGE_TREE = 300;

/** One rendered `lineage` code block. Owns its listeners and cleans up on unload. */
export class LineageBlock extends MarkdownRenderChild implements HoverParent {
	hoverPopover: HoverPopover | null = null;
	private panzoom: PanZoom | null = null;
	private lastSeed: string | null = null;
	private refreshSoon = debounce(() => this.render(false), 300, true);

	constructor(
		private plugin: LineagePlugin,
		containerEl: HTMLElement,
		private source: string,
		private ctx: MarkdownPostProcessorContext,
	) {
		super(containerEl);
	}

	onload(): void {
		// Stop Live Preview from switching the block to source when it is clicked.
		for (const type of ["click", "mousedown", "pointerdown"] as const) {
			this.registerDomEvent(this.containerEl, type, (e) => e.stopPropagation());
		}
		this.render(true);
		this.register(this.plugin.index.subscribe(() => this.refreshSoon()));
		this.register(this.plugin.onSettingsChange(() => this.refreshSoon()));
	}

	onunload(): void {
		this.refreshSoon.cancel();
		this.panzoom?.destroy();
		this.panzoom = null;
	}

	private render(fit: boolean): void {
		// Keep the user's pan and zoom across live updates of the same tree.
		const previous: ViewState | null = !fit && this.panzoom?.touched ? { ...this.panzoom.state } : null;
		this.panzoom?.destroy();
		this.panzoom = null;
		const el = this.containerEl;
		el.empty();
		el.addClass("lineage-container");

		try {
			this.renderTree(el, previous);
		} catch (e) {
			console.error("Lineage failed to render", e);
			el.empty();
			el.createDiv({ cls: "lineage-error", text: `Lineage could not draw this tree: ${e instanceof Error ? e.message : String(e)}` });
		}
	}

	private renderTree(el: HTMLElement, previous: ViewState | null): void {
		const { settings, index } = this.plugin;
		const opts = parseBlockOptions(this.source, { depth: settings.defaultDepth, height: settings.defaultHeight });
		if (!opts.seed) {
			el.createDiv({ cls: "lineage-error", text: "No seed given. Add a line like: seed: [[Person Name]]" });
			return;
		}
		index.ensureBuilt();
		const seedFile = index.resolve(opts.seed, this.ctx.sourcePath);
		if (!seedFile) {
			el.createDiv({ cls: "lineage-error", text: `Seed note not found: ${opts.seed}` });
			return;
		}

		const tree = buildTree(index.store, seedFile.path, opts.depth);
		const layout = layoutTree(tree, makeMeasure());
		const warnings: LineageWarning[] = [
			...opts.problems.map((message) => ({ message })),
			...tree.warnings,
			...layout.warnings,
		];

		const viewport = el.createDiv({ cls: "lineage-viewport" });
		viewport.style.height = `${opts.height}px`;
		const { svg, stage } = buildViewSvg(document, layout, tree.seed);
		viewport.appendChild(svg);
		this.wireLinks(svg);

		const panzoom = new PanZoom(viewport, stage, layout);
		this.panzoom = panzoom;
		if (previous && this.lastSeed === seedFile.path) panzoom.restore(previous);
		else panzoom.fit();
		this.lastSeed = seedFile.path;

		this.buildToolbar(viewport, layout, seedFile.basename);

		if (tree.persons.size > LARGE_TREE) {
			el.createDiv({
				cls: "lineage-notice",
				text: `This tree has ${tree.persons.size} people. A lower depth will be quicker to draw and easier to read.`,
			});
		}
		if (warnings.length) this.buildWarnings(el, warnings);
	}

	private buildToolbar(viewport: HTMLElement, layout: Layout, seedName: string) {
		const bar = viewport.createDiv({ cls: "lineage-toolbar" });
		const button = (icon: string, label: string, onClick: () => void) => {
			const b = bar.createEl("button", { cls: "lineage-button clickable-icon", attr: { "aria-label": label } });
			setIcon(b, icon);
			b.addEventListener("click", (e) => {
				e.preventDefault();
				onClick();
			});
		};
		const { app } = this.plugin;
		button("maximize", "Fit to view", () => this.panzoom?.fit());
		button("file-down", "Export PDF", () =>
			exportTree(app, this.plugin.settings, layout, seedName, this.ctx.sourcePath, "pdf"),
		);
		button("file-image", "Export SVG", () =>
			exportTree(app, this.plugin.settings, layout, seedName, this.ctx.sourcePath, "svg"),
		);
		button("refresh-cw", "Refresh", () => {
			this.plugin.index.invalidate();
			this.render(true);
		});
	}

	private buildWarnings(el: HTMLElement, warnings: LineageWarning[]) {
		const details = el.createEl("details", { cls: "lineage-warnings" });
		details.createEl("summary", { text: warnings.length === 1 ? "1 warning" : `${warnings.length} warnings` });
		const list = details.createEl("ul");
		for (const w of warnings) {
			const li = list.createEl("li");
			if (w.path) {
				const a = li.createEl("a", { cls: "internal-link", text: w.name ?? w.path, href: w.path });
				a.addEventListener("click", (e) => {
					e.preventDefault();
					this.plugin.app.workspace.openLinkText(w.path as string, this.ctx.sourcePath, Keymap.isModEvent(e));
				});
				a.addEventListener("mouseover", (e) => this.hover(e, a, w.path as string));
				li.appendText(": ");
			}
			li.appendText(w.message);
		}
	}

	private wireLinks(svg: SVGSVGElement) {
		const target = (e: Event) => (e.target as Element).closest?.("[data-path]") as SVGGElement | null;
		svg.addEventListener("click", (e) => {
			const g = target(e);
			if (!g) return;
			e.preventDefault();
			this.plugin.app.workspace.openLinkText(g.dataset.path as string, this.ctx.sourcePath, Keymap.isModEvent(e));
		});
		svg.addEventListener("mouseover", (e) => {
			const g = target(e);
			if (g) this.hover(e, g, g.dataset.path as string);
		});
	}

	private hover(event: MouseEvent, targetEl: Element, linktext: string) {
		this.plugin.app.workspace.trigger("hover-link", {
			event,
			source: HOVER_SOURCE,
			hoverParent: this,
			targetEl,
			linktext,
			sourcePath: this.ctx.sourcePath,
		});
	}
}

/** Text widths from a canvas, using the theme's actual text font. */
function makeMeasure(): Measure {
	const probe = document.body.createDiv({ attr: { style: "position:absolute;visibility:hidden;font-family:var(--font-text);" } });
	const family = getComputedStyle(probe).fontFamily || "sans-serif";
	probe.remove();
	const ctx = document.createElement("canvas").getContext("2d");
	const cache = new Map<string, number>();
	return (text, kind) => {
		const key = `${kind}\u0000${text}`;
		let w = cache.get(key);
		if (w === undefined) {
			const size = kind === "name" ? METRICS.nameSize : METRICS.yearsSize;
			if (ctx) {
				// Measure bold so the highlighted seed name never overflows its slot.
				ctx.font = `${kind === "name" ? "600 " : ""}${size}px ${family}`;
				w = ctx.measureText(text).width;
			} else {
				w = text.length * size * 0.6;
			}
			cache.set(key, w);
		}
		return w;
	};
}
