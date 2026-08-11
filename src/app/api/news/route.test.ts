import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route";

const STARTED_AT = "2026-08-01T12:00:00.000Z";

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

test("relaxes Google queries sequentially and accepts an old national-tier article", async () => {
  const originalFetch = globalThis.fetch;
  const requestedEndpoints: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const endpoint = input instanceof Request ? input.url : String(input);
    requestedEndpoints.push(endpoint);
    const providerQuery = new URL(endpoint).searchParams.get("q");
    const xml = providerQuery === '"Portugal" (wildfire OR fire)'
      ? "<rss><channel>"
        + "<item><title>Portugal wildfire archive</title><link>https://example.com/national</link><description>Fire coverage</description><pubDate>2020-01-01T00:00:00.000Z</pubDate></item>"
        + "</channel></rss>"
      : "<rss><channel></channel></rss>";
    return new Response(xml, { status: 200, headers: { "Content-Type": "application/rss+xml" } });
  };

  try {
    const query = new URLSearchParams({
      location: "Pardieiros / Arganil, Coimbra, Portugal",
      region: "Coimbra",
      country: "Portugal",
      startedAt: STARTED_AT,
      locale: "en",
    }).toString();
    const response = await GET(request(query));
    const payload = await response.json() as { articles?: Array<{ link: string }> };

    assert.equal(response.status, 200);
    assert.deepEqual(payload.articles?.map((article) => article.link), ["https://example.com/national"]);
    assert.deepEqual(requestedEndpoints.map((endpoint) => new URL(endpoint).searchParams.get("q")), [
      '"Pardieiros" "Coimbra" "Portugal" (wildfire OR fire) when:3d',
      '"Coimbra" "Portugal" (wildfire OR fire) when:7d',
      '"Portugal" (wildfire OR fire)',
    ]);
    assert.match(requestedEndpoints[0], /q=%22Pardieiros%22%20%22Coimbra%22%20%22Portugal%22%20\(wildfire%20OR%20fire\)%20when%3A3d/);
    assert.ok(!requestedEndpoints[0].includes("%2522"), "the q parameter must not be double encoded");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stops after the first nonempty parsed Google tier", async () => {
  const originalFetch = globalThis.fetch;
  const providerQueries: Array<string | null> = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const endpoint = new URL(input instanceof Request ? input.url : String(input));
    const providerQuery = endpoint.searchParams.get("q");
    providerQueries.push(providerQuery);
    const xml = providerQuery?.includes("when:7d")
      ? "<rss><channel><item><title>Regional fire update</title><link>https://example.com/regional</link><pubDate>2026-08-02T00:00:00.000Z</pubDate></item></channel></rss>"
      : "<rss><channel></channel></rss>";
    return new Response(xml, { status: 200 });
  };

  try {
    const response = await GET(request(new URLSearchParams({
      location: "Pardieiros / Arganil, Coimbra, Portugal",
      region: "Coimbra",
      country: "Portugal",
      startedAt: STARTED_AT,
      locale: "en",
    }).toString()));
    const payload = await response.json() as { articles: Array<{ link: string }> };

    assert.deepEqual(payload.articles.map((article) => article.link), ["https://example.com/regional"]);
    assert.deepEqual(providerQueries, [
      '"Pardieiros" "Coimbra" "Portugal" (wildfire OR fire) when:3d',
      '"Coimbra" "Portugal" (wildfire OR fire) when:7d',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses Bing only for a Google network error, then resumes Google relaxation", async () => {
  const originalFetch = globalThis.fetch;
  const attempts: Array<{ host: string; query: string | null }> = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const endpoint = new URL(input instanceof Request ? input.url : String(input));
    const query = endpoint.searchParams.get("q");
    attempts.push({ host: endpoint.hostname, query });

    if (endpoint.hostname === "news.google.com" && query?.includes("when:3d")) {
      throw new TypeError("simulated network failure");
    }
    if (endpoint.hostname === "www.bing.com") {
      return new Response("<rss><channel></channel></rss>", { status: 200 });
    }
    return new Response(
      "<rss><channel><item><title>Coimbra wildfire update</title><link>https://example.com/recovered</link><pubDate>2026-08-03T00:00:00.000Z</pubDate></item></channel></rss>",
      { status: 200 },
    );
  };

  try {
    const response = await GET(request(new URLSearchParams({
      location: "Pardieiros / Arganil, Coimbra, Portugal",
      region: "Coimbra",
      country: "Portugal",
      startedAt: STARTED_AT,
      locale: "en",
    }).toString()));
    const payload = await response.json() as { articles: Array<{ link: string }> };

    assert.deepEqual(payload.articles.map((article) => article.link), ["https://example.com/recovered"]);
    assert.deepEqual(attempts, [
      { host: "news.google.com", query: '"Pardieiros" "Coimbra" "Portugal" (wildfire OR fire) when:3d' },
      { host: "www.bing.com", query: '"Pardieiros" "Coimbra" "Portugal" (wildfire OR fire) when:3d' },
      { host: "news.google.com", query: '"Coimbra" "Portugal" (wildfire OR fire) when:7d' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not use Bing for a Google HTTP error", async () => {
  const originalFetch = globalThis.fetch;
  const attemptedHosts: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const endpoint = new URL(input instanceof Request ? input.url : String(input));
    attemptedHosts.push(endpoint.hostname);
    return new Response("unavailable", { status: 503 });
  };

  try {
    const response = await GET(request(new URLSearchParams({
      location: "Pardieiros / Arganil, Coimbra, Portugal",
      region: "Coimbra",
      country: "Portugal",
      startedAt: STARTED_AT,
      locale: "en",
    }).toString()));

    assert.equal(response.status, 502);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(attemptedHosts, ["news.google.com"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects an oversized RSS payload without retrying another provider", async () => {
  const originalFetch = globalThis.fetch;
  const attemptedHosts: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const endpoint = new URL(input instanceof Request ? input.url : String(input));
    attemptedHosts.push(endpoint.hostname);
    return new Response(`<rss><channel>${"x".repeat(300_000)}</channel></rss>`, { status: 200 });
  };

  try {
    const response = await GET(request(new URLSearchParams({
      location: "Pardieiros / Arganil, Coimbra, Portugal",
      region: "Coimbra",
      country: "Portugal",
      startedAt: STARTED_AT,
      locale: "en",
    }).toString()));

    assert.equal(response.status, 502);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(attemptedHosts, ["news.google.com"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("enforces one overall deadline across sequential empty tiers", async () => {
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  let nowMs = 0;
  let attempts = 0;
  Date.now = () => nowMs;
  globalThis.fetch = async () => {
    attempts += 1;
    nowMs += 6_000;
    return new Response("<rss><channel></channel></rss>", { status: 200 });
  };

  try {
    const response = await GET(request(new URLSearchParams({
      location: "Pardieiros / Arganil, Coimbra, Portugal",
      region: "Coimbra",
      country: "Portugal",
      startedAt: STARTED_AT,
      locale: "en",
    }).toString()));

    assert.equal(response.status, 502);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(attempts, 2);
  } finally {
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
  }
});
