import { App, MarkdownView, TFile } from "obsidian";
import { rewriteBody } from "./options";

/**
 * Replace the body of the lineage block between fence lines `start` and
 * `end`, provided it still reads `oldBody`. Returns false and changes nothing
 * if the note has moved on.
 */
export async function writeBlockBody(app: App, file: TFile, start: number, end: number, oldBody: string, newBody: string): Promise<boolean> {
	// Edit through an open editor where there is one, so unsaved typing, the
	// cursor and undo history are kept. Reading view has nothing unsaved.
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view;
		if (!(view instanceof MarkdownView) || view.file?.path !== file.path || view.getMode() !== "source") continue;
		const editor = view.editor;
		const body = rewriteBody(editor.getValue().split("\n"), start, end, oldBody, newBody);
		if (!body) return false;
		editor.replaceRange(body.map((l) => `${l}\n`).join(""), { line: start + 1, ch: 0 }, { line: end, ch: 0 });
		return true;
	}

	let ok = false;
	await app.vault.process(file, (data) => {
		const eol = data.includes("\r\n") ? "\r\n" : "\n";
		const lines = data.split(/\r?\n/);
		const body = rewriteBody(lines, start, end, oldBody, newBody);
		if (!body) return data;
		ok = true;
		lines.splice(start + 1, end - start - 1, ...body);
		return lines.join(eol);
	});
	return ok;
}
