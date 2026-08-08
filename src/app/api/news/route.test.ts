import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route";

function request(query: string): Request {
  return new Request(`http://localhost/api/news?${query}`);
}

test("news route validates the expanded request contract before fetching", async () => {
  const missingCutoff = await GET(request("location=Leiria&locale=pt"));
  assert.equal(missingCutoff.status, 400);

  const invalidCutoff = await GET(request("location=Leiria&publishedAfter=not-a-date&locale=pt"));
  assert.equal(invalidCutoff.status, 400);

  const invalidLocale = await GET(request("location=Leiria&publishedAfter=2026-08-01T00%3A00%3A00Z&locale=fr"));
  assert.equal(invalidLocale.status, 400);
});
