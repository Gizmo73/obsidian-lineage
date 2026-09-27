import { App, normalizePath, Notice, TFolder } from "obsidian";
import { Layout } from "./layout";
import { svgToPdf } from "./pdf";
import { LineageSettings } from "./settings";
import { buildExportSvg, serializeSvg } from "./svg";

/**
 * Save the tree into the vault as PDF or SVG. Uses the vault API rather than a
 * browser download, which does nothing on mobile.
 */
export async function exportTree(
	app: App,
	settings: LineageSettings,
	layout: Layout,
	seedName: string,
	sourcePath: string,
	kind: "pdf" | "svg",
): Promise<void> {
	const notice = new Notice(`Exporting ${kind.toUpperCase()}…`, 0);
	try {
		const folder = await ensureFolder(app, exportFolder(app, settings, sourcePath));
		const path = uniquePath(app, folder, `${safeName(seedName)} family tree`, kind);
		const svg = buildExportSvg(document, layout);
		if (kind === "svg") {
			await app.vault.create(path, serializeSvg(svg));
		} else {
			// svg2pdf reads styles from the live DOM, so attach it off screen while converting.
			const holder = document.body.createDiv({ attr: { style: "position:fixed;left:-100000px;top:0;" } });
			holder.appendChild(svg);
			try {
				const pdf = await svgToPdf(svg, layout.width, layout.height, settings.pdfPageSize);
				await app.vault.createBinary(path, pdf);
			} finally {
				holder.remove();
			}
		}
		notice.hide();
		new Notice(`Saved ${path}`);
	} catch (e) {
		notice.hide();
		console.error("Lineage export failed", e);
		new Notice(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
	}
}

function exportFolder(app: App, settings: LineageSettings, sourcePath: string): string {
	if (settings.exportFolder) return normalizePath(settings.exportFolder);
	const parent = app.vault.getAbstractFileByPath(sourcePath)?.parent;
	return parent && !parent.isRoot() ? parent.path : "";
}

async function ensureFolder(app: App, folder: string): Promise<string> {
	if (!folder || folder === "/") return "";
	const existing = app.vault.getAbstractFileByPath(folder);
	if (existing instanceof TFolder) return folder;
	if (existing) throw new Error(`${folder} is a file, not a folder`);
	// Create each level, since older Obsidian versions do not create parents.
	let path = "";
	for (const part of folder.split("/")) {
		path = path ? `${path}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(path)) await app.vault.createFolder(path);
	}
	return folder;
}

function uniquePath(app: App, folder: string, base: string, ext: string): string {
	const prefix = folder ? `${folder}/` : "";
	for (let n = 1; ; n++) {
		const path = normalizePath(`${prefix}${base}${n === 1 ? "" : ` ${n}`}.${ext}`);
		if (!app.vault.getAbstractFileByPath(path)) return path;
	}
}

/** Strip characters that are not allowed in file names on some platforms. */
function safeName(name: string): string {
	return name.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "Lineage";
}
