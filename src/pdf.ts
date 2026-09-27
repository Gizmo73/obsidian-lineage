import { jsPDF } from "jspdf";
import { svg2pdf } from "svg2pdf.js";

export type PdfPageSize = "fit" | "a4" | "a3";

/** CSS px to PDF points. */
const PX_TO_PT = 0.75;
/** jsPDF's (and Acrobat's) largest page side, in points. */
const MAX_SIDE = 14400;
const MARGIN = 28;

const PAGE_SIZES: Record<Exclude<PdfPageSize, "fit">, [number, number]> = {
	a4: [841.89, 595.28],
	a3: [1190.55, 841.89],
};

/**
 * Draws the export SVG into a one-page PDF. Text stays real text in the
 * built-in Helvetica, so it is selectable and searchable.
 */
export async function svgToPdf(svg: SVGSVGElement, width: number, height: number, size: PdfPageSize): Promise<ArrayBuffer> {
	let pageW: number;
	let pageH: number;
	if (size === "fit") {
		const scale = Math.min(PX_TO_PT, (MAX_SIDE - 2 * MARGIN) / width, (MAX_SIDE - 2 * MARGIN) / height);
		pageW = width * scale + 2 * MARGIN;
		pageH = height * scale + 2 * MARGIN;
	} else {
		[pageW, pageH] = PAGE_SIZES[size];
	}
	const scale = Math.min(PX_TO_PT, (pageW - 2 * MARGIN) / width, (pageH - 2 * MARGIN) / height);
	const drawW = width * scale;
	const drawH = height * scale;

	const doc = new jsPDF({
		orientation: pageW >= pageH ? "landscape" : "portrait",
		unit: "pt",
		format: [pageW, pageH],
		compress: true,
	});
	await svg2pdf(svg, doc, {
		x: (pageW - drawW) / 2,
		y: (pageH - drawH) / 2,
		width: drawW,
		height: drawH,
	});
	return doc.output("arraybuffer");
}
