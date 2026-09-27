// Browser harness: lays out trees passed in from Node and renders both the
// themed view and the export version, and builds a PDF with the real code.
import { layoutTree } from "../../src/layout";
import { svgToPdf } from "../../src/pdf";
import { buildExportSvg, buildViewSvg } from "../../src/svg";
import { Tree } from "../../src/types";

declare global {
	interface Window {
		renderTree(tree: any, mode: "view" | "export"): { width: number; height: number; warnings: string[] };
		makePdf(tree: any, size: "fit" | "a4" | "a3"): Promise<string>;
	}
}

const ctx = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
const measure = (text: string, kind: "name" | "years") => {
	ctx.font = kind === "name" ? "13px sans-serif" : "11px sans-serif";
	return ctx.measureText(text).width;
};

function revive(t: any): Tree {
	return { ...t, persons: new Map(t.persons) };
}

window.renderTree = (raw, mode) => {
	const tree = revive(raw);
	const layout = layoutTree(tree, measure);
	document.body.innerHTML = "";
	if (mode === "view") {
		const { svg } = buildViewSvg(document, layout, tree.seed);
		svg.setAttribute("width", String(layout.width));
		svg.setAttribute("height", String(layout.height));
		document.body.appendChild(svg);
	} else {
		document.body.appendChild(buildExportSvg(document, layout));
	}
	return { width: layout.width, height: layout.height, warnings: [...tree.warnings, ...layout.warnings].map((w) => w.message) };
};

window.makePdf = async (raw, size) => {
	const layout = layoutTree(revive(raw), measure);
	const svg = buildExportSvg(document, layout);
	document.body.appendChild(svg);
	const buf = await svgToPdf(svg, layout.width, layout.height, size);
	svg.remove();
	let s = "";
	new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
	return btoa(s);
};

// ---- Pan/zoom check: mounts the view inside a scrollable page. ----
import { PanZoom } from "../../src/panzoom";

declare global {
	interface Window {
		mountPanZoom(tree: any): void;
		pz: PanZoom;
		clicks: string[];
	}
}

window.mountPanZoom = (raw) => {
	const tree = revive(raw);
	const layout = layoutTree(tree, measure);
	document.body.innerHTML = `<div style="height:300px">above</div><div id="vp" class="lineage-viewport" style="width:600px;height:400px;margin:0 20px"></div><div style="height:2000px">below</div>`;
	const vp = document.getElementById("vp") as HTMLElement;
	const { svg, stage } = buildViewSvg(document, layout, tree.seed);
	vp.appendChild(svg);
	window.clicks = [];
	svg.addEventListener("click", (e) => {
		const g = (e.target as Element).closest("[data-path]") as SVGGElement | null;
		if (g) window.clicks.push(g.dataset.path as string);
	});
	window.pz = new PanZoom(vp, stage, layout);
	window.pz.fit();
};
