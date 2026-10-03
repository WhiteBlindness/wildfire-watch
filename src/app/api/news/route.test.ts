import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route";

// The route caches results per place in memory for the life of the isolate,
// so each test below uses a different village.
const DAY = 24 * 60 * 60 * 1_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

function request(query: string): Request {
  return new Request(`http://localhost/api/news?${query}`);
}

function newsQuery(village: string, overrides: Record<string, string> = {}): Request {
  return request(new URLSearchParams({
    location: `${village} / Arganil, Coimbra, Portugal`,
    region: "Coimbra",
    country: "Portugal",
    locale: "en",
    ...overrides,
  }).toString());
}

function withFetch(handler: (endpoint: URL) => Promise<Response>): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => handler(new URL(input instanceof Request ? input.url : String(input)))) as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

const rss = (items: string) => `<rss><channel>${items}</channel></rss>`;
const rssItem = (title: string, link: string, publishedAt: string) =>
  `<item><title>${title}</title><link>${link}</link><description>Fire coverage</description><pubDate>${publishedAt}</pubDate></item>`;

test("validates the request before contacting any provider", async () => {
  let calls = 0;
  const restore = withFetch(async () => { calls += 1; return new Response(rss("")); });
  try {
    for (const query of [
      "locale=pt",
      "location=L&locale=pt",
      `location=${"a".repeat(101)}&locale=pt`,
      "location=Leiria&locale=fr",
      "location=%3Cscript%3Ealert(1)%3C%2Fscript%3E&locale=pt",
      `location=Leiria&country=${"b".repeat(61)}&locale=pt`,
      "location=Leiria&region=http%3A%2F%2Fexample.com%3Fq%3D1&locale=pt",
    ]) {
      assert.equal((await GET(request(query))).status, 400, query);
    }
  } finally {
    restore();
  }
  assert.equal(calls, 0);
});

test("relaxes Google queries tier by tier, never older than 30 days", async () => {
  const queries: Array<string | null> = [];
  const restore = withFetch(async (endpoint) => {
    const query = endpoint.searchParams.get("q");
    queries.push(query);
    return new Response(query?.endsWith("when:30d")
      ? rss(rssItem("Portugal wildfire archive", "https://example.com/archive", "2020-01-01T00:00:00.000Z")
        + rssItem("Portugal wildfire update", "https://example.com/national", daysAgo(10)))
      : rss(""));
  });

  try {
    const response = await GET(newsQuery("Pardieiros"));
    const payload = await response.json() as { articles: Array<{ link: string }> };

    assert.equal(response.status, 200);
    assert.deepEqual(payload.articles.map((article) => article.link), ["https://example.com/national"]);
    assert.deepEqual(queries, [
      '"Pardieiros" "Coimbra" "Portugal" (wildfire OR fire) when:3d',
      '"Coimbra" "Portugal" (wildfire OR fire) when:7d',
      '"Portugal" (wildfire OR fire) when:30d',
    ]);
  } finally {
    restore();
  }
});

test("stops after the first tier with articles and serves repeats from memory", async () => {
  const queries: Array<string | null> = [];
  const restore = withFetch(async (endpoint) => {
    const query = endpoint.searchParams.get("q");
    queries.push(query);
    return new Response(query?.includes("when:7d")
      ? rss(rssItem("Regional fire update", "https://example.com/regional", daysAgo(1)))
      : rss(""));
  });

  try {
    const first = await (await GET(newsQuery("Benfeita"))).json() as { articles: Array<{ link: string }> };
    const repeat = await (await GET(newsQuery("  benfeita "))).json() as { articles: Array<{ link: string }> };

    assert.deepEqual(first.articles.map((article) => article.link), ["https://example.com/regional"]);
    assert.deepEqual(repeat.articles, first.articles);
    assert.equal(queries.length, 2, "the repeat, differing only in case and spacing, must not reach a provider");
  } finally {
    restore();
  }
});

test("uses Bing only for a Google network error, then resumes Google relaxation", async () => {
  const attempts: Array<{ host: string; query: string | null }> = [];
  const restore = withFetch(async (endpoint) => {
    const query = endpoint.searchParams.get("q");
    attempts.push({ host: endpoint.hostname, query });
    if (endpoint.hostname === "news.google.com" && query?.includes("when:3d")) throw new TypeError("simulated network failure");
    if (endpoint.hostname === "www.bing.com") return new Response(rss(""));
    return new Response(rss(rssItem("Coimbra wildfire update", "https://example.com/recovered", daysAgo(2))));
  });

  try {
    const payload = await (await GET(newsQuery("Coja"))).json() as { articles: Array<{ link: string }> };
    assert.deepEqual(payload.articles.map((article) => article.link), ["https://example.com/recovered"]);
    assert.deepEqual(attempts, [
      { host: "news.google.com", query: '"Coja" "Coimbra" "Portugal" (wildfire OR fire) when:3d' },
      { host: "www.bing.com", query: '"Coja" "Coimbra" "Portugal" (wildfire OR fire) when:3d' },
      { host: "news.google.com", query: '"Coimbra" "Portugal" (wildfire OR fire) when:7d' },
    ]);
  } finally {
    restore();
  }
});

test("does not use Bing for a Google HTTP error, and does not cache the failure", async () => {
  const hosts: string[] = [];
  const restore = withFetch(async (endpoint) => {
    hosts.push(endpoint.hostname);
    return new Response("unavailable", { status: 503 });
  });

  try {
    const first = await GET(newsQuery("Folques"));
    assert.equal(first.status, 502);
    assert.equal(first.headers.get("cache-control"), "no-store");
    assert.deepEqual(hosts, ["news.google.com"]);
    await GET(newsQuery("Folques"));
    assert.equal(hosts.length, 2, "a failed lookup is retried, not served from cache");
  } finally {
    restore();
  }
});

test("rejects an oversized RSS payload without retrying another provider", async () => {
  const hosts: string[] = [];
  const restore = withFetch(async (endpoint) => {
    hosts.push(endpoint.hostname);
    return new Response(rss("x".repeat(300_000)));
  });

  try {
    const response = await GET(newsQuery("Secarias"));
    assert.equal(response.status, 502);
    assert.deepEqual(hosts, ["news.google.com"]);
  } finally {
    restore();
  }
});

test("enforces one overall deadline across sequential empty tiers", async () => {
  const originalDateNow = Date.now;
  let nowMs = originalDateNow();
  let attempts = 0;
  Date.now = () => nowMs;
  const restore = withFetch(async () => {
    attempts += 1;
    nowMs += 6_000;
    return new Response(rss(""));
  });

  try {
    const response = await GET(newsQuery("Pomares"));
    assert.equal(response.status, 502);
    assert.equal(attempts, 2);
  } finally {
    Date.now = originalDateNow;
    restore();
  }
});
