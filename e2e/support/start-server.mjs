// Starts the production OpenNext build under `wrangler dev` with a local KV
// namespace seeded from the synthetic feed. Playwright runs this as its web
// server; it needs `npm run build:cloudflare` to have run first.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildHealthyIngest, buildSnapshot } from "./synthetic-feed.mjs";

const PORT = process.env.E2E_PORT ?? "8788";
const STATE_DIR = path.join(".wrangler", "e2e-state");
const SNAPSHOT_KEY = "active-fires:v1";
const HEALTH_KEY = "active-fires:ingest-health:v1";

if (!existsSync(path.join(".open-next", "worker.js"))) {
  console.error("No OpenNext build found. Run `npm run build:cloudflare` first.");
  process.exit(1);
}

const snapshot = buildSnapshot(Date.now());
const health = buildHealthyIngest(snapshot);
const fixtureDir = mkdtempSync(path.join(tmpdir(), "wildfire-watch-e2e-"));
const files = { [SNAPSHOT_KEY]: snapshot, [HEALTH_KEY]: health };

rmSync(STATE_DIR, { recursive: true, force: true });
for (const [key, value] of Object.entries(files)) {
  const file = path.join(fixtureDir, `${key.replace(/[^a-z0-9]/gi, "_")}.json`);
  writeFileSync(file, JSON.stringify(value));
  const result = spawnSync("npx", ["wrangler", "kv", "key", "put", key, "--binding=FIRMS_CACHE", "--local", `--persist-to=${STATE_DIR}`, `--path=${file}`], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
rmSync(fixtureDir, { recursive: true, force: true });

const server = spawn("npx", [
  "wrangler", "dev",
  "--ip=127.0.0.1",
  `--port=${PORT}`,
  `--persist-to=${STATE_DIR}`,
  "--log-level=warn",
  "--show-interactive-dev-session=false",
], { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
