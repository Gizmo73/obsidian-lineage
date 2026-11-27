import { App, HoverParent, Keymap, PaneType } from "obsidian";

/** Page preview source, listed under Settings > Page preview. */
export const HOVER_SOURCE = "lineage-family-tree";

/**
 * Click, middle-click and hover preview for any element under `root` with a
 * data-path attribute: names in a tree, warning links and married lists.
 */
export function wireLinks(app: App, root: Element, hoverParent: HoverParent, sourcePath: () => string): void {
	const linkAt = (node: EventTarget | null) => (node as Element | null)?.closest?.("[data-path]") ?? null;
	const pathOf = (el: Element) => el.getAttribute("data-path") as string;
	const open = (path: string, newLeaf: PaneType | boolean) => void app.workspace.openLinkText(path, sourcePath(), newLeaf);

	root.addEventListener("click", (e) => {
		const link = linkAt(e.target);
		if (!link) return;
		e.preventDefault();
		open(pathOf(link), Keymap.isModEvent(e as MouseEvent));
	});
	// Middle-click opens in a new tab. It fires auxclick, not click, and its
	// mousedown would otherwise start Windows autoscroll or a Linux paste.
	root.addEventListener("mousedown", (e) => {
		if ((e as MouseEvent).button === 1 && linkAt(e.target)) e.preventDefault();
	});
	root.addEventListener("auxclick", (e) => {
		const me = e as MouseEvent;
		const link = me.button === 1 ? linkAt(me.target) : null;
		if (!link) return;
		me.preventDefault();
		open(pathOf(link), Keymap.isModEvent(me) || "tab");
	});
	root.addEventListener("mouseover", (e) => {
		const link = linkAt(e.target);
		// Only on entering a link: moving between its parts fires mouseover
		// again, and each repeat would restart the page preview's delay.
		if (!link || linkAt((e as MouseEvent).relatedTarget) === link) return;
		app.workspace.trigger("hover-link", {
			event: e,
			source: HOVER_SOURCE,
			hoverParent,
			targetEl: link,
			linktext: pathOf(link),
			sourcePath: sourcePath(),
		});
	});
}
