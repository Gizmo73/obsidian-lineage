// Bundles tests/*.test.ts with esbuild and runs them with node's built-in test runner.
import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const tests = readdirSync("tests").filter((f) => f.endsWith(".test.ts"));
// Inside the project so externals resolve from node_modules.
const outdir = mkdtempSync(".test-build-");
try {
	await esbuild.build({
		entryPoints: tests.map((f) => join("tests", f)),
		bundle: true,
		platform: "node",
		format: "esm",
		outdir,
		outExtension: { ".js": ".mjs" },
		packages: "external",
		alias: { obsidian: "./tests/obsidian-mock.ts" },
		logLevel: "warning",
	});
	const files = readdirSync(outdir).map((f) => join(outdir, f));
	const res = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
	process.exitCode = res.status ?? 1;
} finally {
	rmSync(outdir, { recursive: true, force: true });
}
