// Bundles every *.test.ts under src/ and workers/ with esbuild (resolving the
// tsconfig "@/" alias) and runs them with the built-in node:test runner.
// New test files are picked up automatically.
//
//   npm run test:unit                 all unit tests
//   npm run test:unit -- viirs news   only files whose path contains a filter
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOTS = ["src", "workers"];

function findTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : findTests(entryPath);
    return entry.name.endsWith(".test.ts") ? [entryPath] : [];
  });
}

const filters = process.argv.slice(2);
const entryPoints = ROOTS.flatMap(findTests)
  .filter((file) => filters.length === 0 || filters.some((filter) => file.includes(filter)))
  .sort();

if (entryPoints.length === 0) {
  console.error(`No unit tests match: ${filters.join(" ")}`);
  process.exit(1);
}

// Outside node_modules: the test runner ignores files under it.
const OUT_DIR = mkdtempSync(path.join(tmpdir(), "wildfire-watch-unit-"));
await build({
  entryPoints,
  outdir: OUT_DIR,
  outbase: ".",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  logLevel: "warning",
});

const outputs = entryPoints.map((file) => path.join(OUT_DIR, file.replace(/\.ts$/, ".cjs")));
const result = spawnSync(process.execPath, ["--test", ...outputs], { stdio: "inherit" });
rmSync(OUT_DIR, { recursive: true, force: true });
process.exit(result.status ?? 1);
