import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("the root document remains Portuguese from Portugal", async () => {
  const layoutPath = fileURLToPath(new URL("../src/app/layout.tsx", import.meta.url));
  const layout = await readFile(layoutPath, "utf8");
  assert.match(layout, /<html\s+[\s\S]*\blang=["']pt-PT["']/);
});
