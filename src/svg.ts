import { Layout, METRICS, Polyline } from "./layout";

const SVG_NS = "http://www.w3.org/2000/svg";

export const EXPORT_FONT = "Helvetica, Arial, sans-serif";

function el<K extends keyof SVGElementTagNameMap>(
	doc: Document,
	tag: K,
	attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
	const node = doc.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
	return node;
}

function pathData(lines: Polyline[]): string {
	const r = (n: number) => Math.round(n * 10) / 10;
	return lines.map((l) => l.map(([x, y], i) => `${i ? "L" : "M"}${r(x)} ${r(y)}`).join("")).join("");
}

/**
 * The interactive tree: classes only, colours come from styles.css so it
 * follows the theme. Returns the root <svg> and the <g> that pan/zoom moves.
 */
export function buildViewSvg(doc: Document, layout: Layout, seed: string): { svg: SVGSVGElement; stage: SVGGElement } {
	const svg = el(doc, "svg", { class: "lineage-svg" });
	const stage = el(doc, "g", { class: "lineage-stage" });
	svg.appendChild(stage);

	stage.appendChild(el(doc, "path", { class: "lineage-line lineage-descent", d: pathData(layout.descentLines) }));
	stage.appendChild(el(doc, "path", { class: "lineage-line lineage-marriage", d: pathData(layout.marriageLines) }));

	for (const n of layout.nodes) {
		const cls = ["lineage-person"];
		if (n.id === seed) cls.push("is-seed");
		if (!n.info.path) cls.push("is-missing");
		const g = el(doc, "g", { class: cls.join(" ") });
		if (n.info.path) {
			g.setAttribute("data-path", n.info.path);
			g.setAttribute("role", "link");
			g.setAttribute("aria-label", n.info.name);
		}
		const h = n.years ? METRICS.nodeHeight : METRICS.nodeHeightNoYears;
		g.appendChild(
			el(doc, "rect", {
				class: n.id === seed ? "lineage-seed-bg" : "lineage-hit",
				x: n.x - n.width / 2 - 6,
				y: n.y - 4,
				width: n.width + 12,
				height: h + 6,
				rx: 5,
			}),
		);
		const name = el(doc, "text", {
			class: "lineage-name",
			x: n.x,
			y: n.y + METRICS.nameBaseline,
			"text-anchor": "middle",
		});
		name.textContent = n.info.name;
		g.appendChild(name);
		if (n.years) {
			const yrs = el(doc, "text", {
				class: "lineage-years",
				x: n.x,
				y: n.y + METRICS.yearsBaseline,
				"text-anchor": "middle",
			});
			yrs.textContent = n.years;
			g.appendChild(yrs);
		}
		stage.appendChild(g);
	}
	return { svg, stage };
}

/**
 * A standalone print version: black on white, presentation attributes only,
 * no classes, links, highlight or muted styling.
 */
export function buildExportSvg(doc: Document, layout: Layout): SVGSVGElement {
	const w = Math.ceil(layout.width);
	const h = Math.ceil(layout.height);
	const svg = el(doc, "svg", {
		xmlns: SVG_NS,
		version: "1.1",
		width: w,
		height: h,
		viewBox: `0 0 ${w} ${h}`,
	});
	svg.appendChild(el(doc, "rect", { x: 0, y: 0, width: w, height: h, fill: "#ffffff" }));
	const lineAttrs = { fill: "none", stroke: "#000000", "stroke-width": 1, "stroke-linecap": "square" };
	svg.appendChild(el(doc, "path", { ...lineAttrs, d: pathData(layout.descentLines) }));
	svg.appendChild(el(doc, "path", { ...lineAttrs, d: pathData(layout.marriageLines) }));

	for (const n of layout.nodes) {
		const name = el(doc, "text", {
			x: n.x,
			y: n.y + METRICS.nameBaseline,
			"text-anchor": "middle",
			"font-family": EXPORT_FONT,
			"font-size": METRICS.nameSize,
			fill: "#000000",
		});
		name.textContent = n.info.name;
		svg.appendChild(name);
		if (n.years) {
			const yrs = el(doc, "text", {
				x: n.x,
				y: n.y + METRICS.yearsBaseline,
				"text-anchor": "middle",
				"font-family": EXPORT_FONT,
				"font-size": METRICS.yearsSize,
				fill: "#000000",
			});
			yrs.textContent = n.years;
			svg.appendChild(yrs);
		}
	}
	return svg;
}

export function serializeSvg(svg: SVGSVGElement): string {
	return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}\n`;
}
