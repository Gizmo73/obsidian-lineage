import {
	debounce,
	HoverParent,
	HoverPopover,
	Keymap,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownSectionInformation,
	Notice,
	setIcon,
	TFile,
} from "obsidian";
import { writeBlockBody } from "./block-edit";
import { exportTree } from "./export";
import { buildTree, Generations } from "./graph";
import { Layout, layoutTree, Measure, METRICS } from "./layout";
import type LineagePlugin from "./main";
import { PanZoom, ViewState } from "./panzoom";
import { buildViewSvg } from "./svg";
import { parseBlockOptions, withGenerations } from "./options";
import { LineageWarning } from "./types";

export const HOVER_SOURCE = "lineage-family-tree";
const LARGE_TREE = 300;
/** Wait for clicks on the generation controls to settle before rewriting the note. */
const SAVE_DELAY = 800;

/**
 * Pan and zoom handed from a block that just rewrote its source to the block
 * Obsidian draws in its place, keyed by note path and new source.
 */
const carriedViews = new Map<string, ViewState>();
const carryKey = (path: string, source: string) => `${path}\u0000${source}`;

/** One rendered `lineage` code block. Owns its listeners and cleans up on unload. */
export class LineageBlock extends MarkdownRenderChild implements HoverParent {
	hoverPopover: HoverPopover | null = null;
	private panzoom: PanZoom | null = null;
	private lastSeed: string | null = null;
	private refreshSoon = debounce(() => this.render(false), 300, true);
	/** Generation limits set with the controls, drawn at once and saved shortly after. */
	private limits: Generations | null = null;
	private saveTimer: number | null = null;
	/** Where the block was at the last click, in case it cannot be asked once unloading. */
	private lastSection: MarkdownSectionInformation | null = null;
	private saveFailed = false;
	private carried: ViewState | null = null;
	/** The control to focus again after a redraw, so repeated key presses keep working. */
	private focusStep: string | null = null;

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
		const key = carryKey(this.ctx.sourcePath, this.source);
		this.carried = carriedViews.get(key) ?? null;
		carriedViews.delete(key);
		this.render(true);
		this.register(this.plugin.index.subscribe(() => this.refreshSoon()));
		this.register(this.plugin.onSettingsChange(() => this.refreshSoon()));
	}

	onunload(): void {
		this.refreshSoon.cancel();
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
			void this.save();
		}
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
		const opts = parseBlockOptions(this.source, {
			depth: settings.defaultDepth,
			height: settings.defaultHeight,
			ancestors: settings.defaultAncestors,
			descendants: settings.defaultDescendants,
		});
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

		const generations = this.limits ?? opts.generations;
		const tree = buildTree(index.store, seedFile.path, generations ?? opts.depth);
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
		// Controls first, so fitting can leave room for them.
		this.buildToolbar(viewport, layout, seedFile.basename);
		this.buildLimits(viewport, generations ?? { ancestors: settings.defaultAncestors, descendants: settings.defaultDescendants }, !generations);
		if (previous && this.lastSeed === seedFile.path) panzoom.restore(previous);
		else if (this.carried) panzoom.restore(this.carried);
		else panzoom.fit();
		this.carried = null;
		this.lastSeed = seedFile.path;

		if (tree.persons.size > LARGE_TREE) {
			el.createDiv({
				cls: "lineage-notice",
				text: `This tree has ${tree.persons.size} people. ${
					generations ? "Fewer generations" : "A lower depth"
				} will be quicker to draw and easier to read.`,
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

	/**
	 * Up and down steppers in the top-left corner. On a block that uses depth
	 * they start from the default limits, and the first click switches it over.
	 */
	private buildLimits(viewport: HTMLElement, shown: Generations, inactive: boolean) {
		const box = viewport.createDiv({ cls: "lineage-limits" });
		if (inactive) {
			box.addClass("is-inactive");
			box.setAttr("aria-label", "This tree counts hops (depth). Changing these switches it to generations up and down.");
		}
		const spin = (key: keyof Generations, icon: string, label: string) => {
			const group = box.createDiv({ cls: "lineage-spin", attr: { role: "group", "aria-label": label } });
			setIcon(group.createSpan({ cls: "lineage-spin-icon" }), icon);
			const step = (delta: number) => {
				const id = `${key}${delta}`;
				const b = group.createEl("button", {
					cls: "lineage-button clickable-icon",
					attr: { "aria-label": `${delta < 0 ? "Fewer" : "More"} ${label.toLowerCase()}`, "data-step": id },
				});
				setIcon(b, delta < 0 ? "minus" : "plus");
				b.disabled = shown[key] + delta < 0;
				b.addEventListener("click", (e) => {
					e.preventDefault();
					this.changeLimit(shown, key, delta, id);
				});
			};
			step(-1);
			group.createSpan({ cls: "lineage-spin-value", text: String(shown[key]) });
			step(1);
		};
		spin("ancestors", "arrow-up", "Generations up");
		spin("descendants", "arrow-down", "Generations down");

		if (this.focusStep) {
			const buttons = Array.from(box.querySelectorAll<HTMLButtonElement>("button"));
			const target = buttons.find((b) => b.dataset.step === this.focusStep);
			// At 0 the minus button is disabled, so move to its plus button.
			const usable = target && !target.disabled ? target : target?.parentElement?.querySelector<HTMLButtonElement>("button:not([disabled])");
			usable?.focus({ preventScroll: true });
			this.focusStep = null;
		}
	}

	private changeLimit(shown: Generations, key: keyof Generations, delta: number, stepId: string) {
		const next = { ...shown, [key]: Math.max(0, shown[key] + delta) };
		if (next[key] === shown[key]) return;
		this.limits = next;
		this.lastSection = this.ctx.getSectionInfo(this.containerEl) ?? this.lastSection;
		this.focusStep = stepId;
		this.render(false);
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.save();
		}, SAVE_DELAY);
	}

	/** Write the current limits into the note, replacing any depth line. */
	private async save(): Promise<void> {
		if (!this.limits) return;
		const newSource = withGenerations(this.source, this.limits);
		if (newSource === this.source) return;
		const { app } = this.plugin;
		const info = this.ctx.getSectionInfo(this.containerEl) ?? this.lastSection;
		const file = app.vault.getAbstractFileByPath(this.ctx.sourcePath);
		const key = carryKey(this.ctx.sourcePath, newSource);
		// Saving redraws the block, so pass the pan and zoom on to its replacement.
		if (this.panzoom?.touched) carriedViews.set(key, { ...this.panzoom.state });
		let ok = false;
		try {
			if (info && file instanceof TFile) ok = await writeBlockBody(app, file, info.lineStart, info.lineEnd, this.source, newSource);
		} catch (e) {
			console.error("Lineage could not save generation limits", e);
		}
		if (ok) {
			this.source = newSource;
			this.lastSection = null;
			return;
		}
		carriedViews.delete(key);
		if (!this.saveFailed) {
			this.saveFailed = true;
			new Notice("Lineage couldn't save the new generations into the note, because the block has moved or changed. Edit the block to keep them.");
		}
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
					this.open(w.path as string, Keymap.isModEvent(e));
				});
				this.wireMiddleClick(a, () => w.path as string);
				a.addEventListener("mouseover", (e) => this.hover(e, a, w.path as string));
				li.appendText(": ");
			}
			li.appendText(w.message);
		}
	}

	private wireLinks(svg: SVGSVGElement) {
		const person = (node: EventTarget | null) => ((node as Element | null)?.closest?.("[data-path]") as SVGGElement | null) ?? null;
		svg.addEventListener("click", (e) => {
			const g = person(e.target);
			if (!g) return;
			e.preventDefault();
			this.open(g.dataset.path as string, Keymap.isModEvent(e));
		});
		this.wireMiddleClick(svg, (e) => person(e.target)?.dataset.path ?? null);
		svg.addEventListener("mouseover", (e) => {
			const g = person(e.target);
			// Only on entering a name: moving between its text and hit box fires mouseover
			// again, and each repeat would restart the page preview's delay.
			if (g && person(e.relatedTarget) !== g) this.hover(e, g, g.dataset.path as string);
		});
	}

	/** Middle-click opens in a new tab. It fires auxclick, not click. */
	private wireMiddleClick(el: Element, pathAt: (e: MouseEvent) => string | null) {
		// Stop Windows autoscroll and Linux paste from starting on a name.
		el.addEventListener("mousedown", (e) => {
			if ((e as MouseEvent).button === 1 && pathAt(e as MouseEvent)) e.preventDefault();
		});
		el.addEventListener("auxclick", (e) => {
			const me = e as MouseEvent;
			const path = me.button === 1 ? pathAt(me) : null;
			if (!path) return;
			me.preventDefault();
			this.open(path, Keymap.isModEvent(me) || "tab");
		});
	}

	private open(path: string, newLeaf: ReturnType<typeof Keymap.isModEvent>) {
		void this.plugin.app.workspace.openLinkText(path, this.ctx.sourcePath, newLeaf);
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
