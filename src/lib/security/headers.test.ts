import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { contentSecurityPolicy, securityHeaders } from "./headers";

function directive(policy: string, name: string): string[] {
  const entry = policy.split("; ").find((part) => part.startsWith(`${name} `));
  return entry ? entry.split(" ").slice(1) : [];
}

test("the production policy allows only this origin and the named map and weather hosts", () => {
  const policy = contentSecurityPolicy();
  assert.deepEqual(directive(policy, "default-src"), ["'self'"]);
  assert.deepEqual(directive(policy, "connect-src"), [
    "'self'",
    "https://basemaps.cartocdn.com",
    "https://*.basemaps.cartocdn.com",
    "https://server.arcgisonline.com",
    "https://api.open-meteo.com",
  ]);
  assert.deepEqual(directive(policy, "frame-ancestors"), ["'none'"]);
  assert.deepEqual(directive(policy, "worker-src"), ["'self'"], "MapLibre's worker is served from this origin; no blob: workers");
  // No frames at all. child-src stays unset: browsers without worker-src fall back to it for workers.
  assert.deepEqual(directive(policy, "frame-src"), ["'none'"]);
  assert.deepEqual(directive(policy, "child-src"), []);
  assert.deepEqual(directive(policy, "object-src"), ["'none'"]);
  assert.ok(!policy.includes("'unsafe-eval'"), "no eval in production");
  assert.ok(!/(^|\s)\*(\s|;|$)/.test(policy), "no bare wildcard source");
  assert.ok(!/(^|\s)https:(\s|;|$)/.test(policy), "no scheme-wide source");
});

test("development adds only what React Refresh needs", () => {
  assert.deepEqual(directive(contentSecurityPolicy({ development: true }), "script-src"), ["'self'", "'unsafe-inline'", "'unsafe-eval'"]);
});

test("static assets get exactly the headers the Worker sends", () => {
  const file = readFileSync(join(process.cwd(), "public", "_headers"), "utf8");
  const lines = file.split("\n").filter((line) => line.startsWith("  "));
  assert.match(file, /^\/\*$/m, "the rules must cover every path");
  assert.deepEqual(lines, securityHeaders().map(({ key, value }) => `  ${key}: ${value}`));
});
