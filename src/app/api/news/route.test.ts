import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route";

const STARTED_AT = "2026-08-01T12:00:00.000Z";
const EFFECTIVE_CUTOFF = "2026-07-30T12:00:00.000Z";

function request(query: string): Request {
  return new Request(`http://localhost/api/news?${query}`);
}

test("news route validates the expanded request contract before fetching", async () => {
  const missingCutoff = await GET(request("location=Leiria&locale=pt"));
  assert.equal(missingCutoff.status, 400);

  const invalidCutoff = await GET(request("location=Leiria&startedAt=not-a-date&locale=pt"));
  assert.equal(invalidCutoff.status, 400);

  const invalidLocale = await GET(request("location=Leiria&startedAt=2026-08-01T00%3A00%3A00Z&locale=fr"));
  assert.equal(invalidLocale.status, 400);
});

test("uses the 48-hour cutoff and a single locality in the provider query", async () => {
  const originalFetch = globalThis.fetch;
  const requestedEndpoints: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    requestedEndpoints.push(input instanceof Request ? input.url : String(input));
    const xml = "<rss><channel>"
      + "<item><title>Portugal wildfire response</title><link>https://example.com/boundary</link><description>Fire crews respond</description><pubDate>"
      + EFFECTIVE_CUTOFF
      + "</pubDate></item>"
      + "<item><title>Older fire report</title><link>https://example.com/old</link><description>Wildfire report</description><pubDate>2026-07-30T11:59:59.000Z</pubDate></item>"
      + "</channel></rss>";
    return new Response(xml, { status: 200, headers: { "Content-Type": "application/rss+xml" } });
  };

  try {
    const query = new URLSearchParams({
      location: "Covilhã/Castelo Branco, Portugal",
      region: "Covilhã",
      country: "Portugal",
      startedAt: STARTED_AT,
      locale: "en",
    }).toString();
    const response = await GET(request(query));
    const payload = await response.json() as { articles?: Array<{ link: string }> };

    assert.equal(response.status, 200);
    assert.deepEqual(payload.articles?.map((article) => article.link), ["https://example.com/boundary"]);
    assert.equal(requestedEndpoints.length, 1);

    const providerQuery = new URL(requestedEndpoints[0]).searchParams.get("q");
    assert.equal(providerQuery, '(wildfire OR fire OR incêndio) "Covilhã" after:2026-07-30');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
