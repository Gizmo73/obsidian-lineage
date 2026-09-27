// Usage: node scripts/harness/run.mjs <outdir>
// Renders the demo trees to PNG (view + export) and PDF using headless Chromium.
import esbuild from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const out = process.argv[2] ?? "harness-out";
mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

// Build trees in Node with the same store code the tests use.
const treesJs = await esbuild.build({
	stdin: {
		contents: `
			import { loadVault } from "./tests/vault";
			import { buildTree } from "./src/graph";
			const { store } = loadVault();
			const cases = [
				["tamsin-10", "People/Tamsin Thornvale.md", 10],
				["brannoc-1", "People/Brannoc Thornvale.md", 1],
				["brannoc-3", "People/Brannoc Thornvale.md", 3],
				["vesper-5", "Edge cases/Vesper Loop.md", 5],
			];
			console.log(JSON.stringify(cases.map(([n, s, d]) => {
				const t = buildTree(store, s, d);
				return [n, { ...t, persons: Array.from(t.persons) }];
			})));`,
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true, platform: "node", format: "cjs", write: false, packages: "external",
});
const { execFileSync } = await import("node:child_process");
const trees = JSON.parse(execFileSync(process.execPath, ["-e", treesJs.outputFiles[0].text]).toString());

const page = await esbuild.build({ entryPoints: ["scripts/harness/page.ts"], bundle: true, format: "iife", write: false, external: ["html2canvas", "dompurify", "canvg", "core-js"] });
const css = readFileSync("styles.css", "utf8");
const html = `<!doctype html><html><head><style>
	body { margin: 0; background: #fff; --text-normal:#222; --text-muted:#888; --text-faint:#aaa;
	  --background-modifier-border:#999; --interactive-accent:#7c3aed; --font-text: sans-serif; font-family: sans-serif; }
	${css}</style></head><body></body></html>`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const tab = await browser.newPage({ deviceScaleFactor: 1.5 });
await tab.setContent(html);
await tab.addScriptTag({ content: page.outputFiles[0].text });
for (const [name, tree] of trees) {
	for (const mode of ["view", "export"]) {
		const info = await tab.evaluate(([t, m]) => window.renderTree(t, m), [tree, mode]);
		await tab.setViewportSize({ width: Math.ceil(info.width), height: Math.ceil(info.height) });
		await tab.screenshot({ path: join(out, `${name}-${mode}.png`) });
		if (mode === "view") console.log(name, Math.round(info.width), "x", Math.round(info.height), info.warnings);
	}
	for (const size of ["fit", "a4"]) {
		const b64 = await tab.evaluate(([t, s]) => window.makePdf(t, s), [tree, size]);
		writeFileSync(join(out, `${name}-${size}.pdf`), Buffer.from(b64, "base64"));
	}
}
await browser.close();
