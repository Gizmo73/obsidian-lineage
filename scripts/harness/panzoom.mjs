// Drives PanZoom in Chromium with mouse and touch input and checks the results.
import esbuild from "esbuild";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const page = await esbuild.build({ entryPoints: ["scripts/harness/page.ts"], bundle: true, format: "iife", write: false, external: ["html2canvas", "dompurify", "canvg", "core-js"] });
const tree = JSON.parse(readFileSync(process.argv[2], "utf8"));
const css = readFileSync("styles.css", "utf8");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

async function setup(opts) {
	const ctx = await browser.newContext({ viewport: { width: 640, height: 600 }, ...opts });
	const tab = await ctx.newPage();
	await tab.setContent(`<!doctype html><style>body{margin:0;--background-modifier-border:#999}${css}</style><body></body>`);
	await tab.addScriptTag({ content: page.outputFiles[0].text });
	await tab.evaluate((t) => window.mountPanZoom(t), tree);
	return tab;
}
const state = (tab) => tab.evaluate(() => ({ ...window.pz.state }));
const nameCentre = (tab, name) =>
	tab.evaluate((n) => {
		const t = Array.from(document.querySelectorAll(".lineage-name")).find((e) => e.textContent === n);
		const r = t.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	}, name);

// Desktop
{
	const tab = await setup({});
	const s0 = await state(tab);
	assert.ok(s0.scale > 0 && s0.scale <= 1.5, "fitted");

	// Click opens a link (no drag).
	const c = await nameCentre(tab, "Brannoc Thornvale");
	await tab.mouse.click(c.x, c.y);
	assert.deepEqual(await tab.evaluate(() => window.clicks), ["People/Brannoc Thornvale.md"]);

	// Drag pans, and does not count as a click.
	await tab.mouse.move(c.x, c.y);
	await tab.mouse.down();
	await tab.mouse.move(c.x + 60, c.y + 30, { steps: 5 });
	await tab.mouse.up();
	const s1 = await state(tab);
	assert.ok(Math.abs(s1.tx - s0.tx - 60) < 1 && Math.abs(s1.ty - s0.ty - 30) < 1, "mouse drag pans");
	assert.equal((await tab.evaluate(() => window.clicks)).length, 1, "drag does not click");

	// Plain wheel scrolls the page, not the tree.
	await tab.mouse.move(300, 400);
	await tab.mouse.wheel(0, 200);
	await tab.waitForTimeout(100);
	assert.ok((await tab.evaluate(() => window.scrollY)) > 0, "plain wheel scrolls page");
	assert.equal((await state(tab)).scale, s1.scale, "plain wheel does not zoom");

	// Ctrl + wheel zooms and does not scroll.
	const y0 = await tab.evaluate(() => window.scrollY);
	await tab.keyboard.down("Control");
	await tab.mouse.wheel(0, -200);
	await tab.keyboard.up("Control");
	await tab.waitForTimeout(100);
	assert.ok((await state(tab)).scale > s1.scale, "ctrl+wheel zooms in");
	assert.equal(await tab.evaluate(() => window.scrollY), y0, "ctrl+wheel does not scroll");
	console.log("desktop ok");
}

// Touch (phone emulation) via CDP touch events.
{
	const tab = await setup({ hasTouch: true, isMobile: true, viewport: { width: 640, height: 600 } });
	const cdp = await tab.context().newCDPSession(tab);
	const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
	const s0 = await state(tab);

	// Tap opens a link.
	const c = await nameCentre(tab, "Pell Thornvale");
	await tab.touchscreen.tap(c.x, c.y);
	assert.deepEqual(await tab.evaluate(() => window.clicks), ["People/Pell Thornvale.md"]);

	// One-finger drag pans the tree and does not scroll the page.
	await touch("touchStart", [[300, 500]]);
	for (let i = 1; i <= 5; i++) await touch("touchMove", [[300 + i * 10, 500 - i * 20]]);
	await touch("touchEnd", []);
	const s1 = await state(tab);
	assert.ok(Math.abs(s1.tx - s0.tx - 50) < 1 && Math.abs(s1.ty - s0.ty + 100) < 1, `one-finger drag pans (${s1.tx - s0.tx}, ${s1.ty - s0.ty})`);
	assert.equal(await tab.evaluate(() => window.scrollY), 0, "drag inside view does not scroll page");

	// Pinch zooms around the fingers.
	await touch("touchStart", [[250, 500], [350, 500]]);
	for (let i = 1; i <= 5; i++) await touch("touchMove", [[250 - i * 10, 500], [350 + i * 10, 500]]);
	await touch("touchEnd", []);
	const s2 = await state(tab);
	assert.ok(Math.abs(s2.scale / s1.scale - 2) < 0.05, `pinch doubles scale (${s2.scale / s1.scale})`);
	assert.equal((await tab.evaluate(() => window.clicks)).length, 1, "gestures do not click");

	// Outside the view, a drag scrolls the page.
	await touch("touchStart", [[300, 280]]);
	for (let i = 1; i <= 5; i++) await touch("touchMove", [[300, 280 - i * 40]]);
	await touch("touchEnd", []);
	await tab.waitForTimeout(300);
	assert.ok((await tab.evaluate(() => window.scrollY)) > 0, "drag outside view scrolls page");

	// Fit restores.
	await tab.evaluate(() => window.pz.fit());
	assert.deepEqual(await state(tab), s0, "fit restores initial view");
	console.log("touch ok");
}
await browser.close();
