import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBingNewsQuery,
  buildGoogleNewsQuery,
  decodeXml,
  filterRssArticles,
  parseRssArticles,
} from "./rss";

const CUTOFF = "2026-08-01T12:00:00.000Z";

function item({
  title,
  link,
  publishedAt,
  description = "Wildfire response coverage",
}: {
  title: string;
  link: string;
  publishedAt: string;
  description?: string;
}): string {
  return `<item><title><![CDATA[${title}]]></title><link>${link}</link><description>${description}</description><pubDate>${publishedAt}</pubDate></item>`;
}

test("keeps the exact acquisition boundary and rejects invalid RSS fields", () => {
  const xml = `<rss><channel>
    ${item({ title: "Old fire", link: "https://example.com/old", publishedAt: "2026-08-01T11:59:59.000Z" })}
    ${item({ title: "Boundary fire", link: "https://example.com/boundary", publishedAt: CUTOFF })}
    ${item({ title: "Later fire", link: "https://example.com/later", publishedAt: "2026-08-02T00:00:00.000Z" })}
    ${item({ title: "Invalid link", link: "javascript:alert(1)", publishedAt: "2026-08-02T01:00:00.000Z" })}
    ${item({ title: "Invalid date", link: "https://example.com/date", publishedAt: "not a date" })}
  </channel></rss>`;

  assert.deepEqual(
    parseRssArticles(xml, { publishedAfter: CUTOFF, requireFireKeyword: true }).map((article) => article.link),
    ["https://example.com/later", "https://example.com/boundary"],
  );
});

test("deduplicates, sorts newest, and limits only after filtering", () => {
  const xml = `<rss><channel>
    ${item({ title: "First", link: "https://example.com/1", publishedAt: "2026-08-01T12:01:00.000Z" })}
    ${item({ title: "Newest duplicate", link: "https://example.com/1", publishedAt: "2026-08-03T12:00:00.000Z" })}
    ${item({ title: "Second", link: "https://example.com/2", publishedAt: "2026-08-02T12:00:00.000Z" })}
    ${item({ title: "Third", link: "https://example.com/3", publishedAt: "2026-08-01T12:02:00.000Z" })}
    ${item({ title: "Fourth", link: "https://example.com/4", publishedAt: "2026-08-01T12:03:00.000Z" })}
  </channel></rss>`;

  assert.deepEqual(
    parseRssArticles(xml, { publishedAfter: CUTOFF, limit: 3 }).map((article) => article.link),
    ["https://example.com/1", "https://example.com/2", "https://example.com/4"],
  );
});

test("requires a fire keyword across title or description when requested", () => {
  const articles = filterRssArticles([
    { title: "Local bulletin", description: "A wildfire is burning nearby", link: "https://example.com/1", publishedAt: CUTOFF },
    { title: "Local football", description: "Match report", link: "https://example.com/2", publishedAt: CUTOFF },
  ], { publishedAfter: CUTOFF, requireFireKeyword: true });

  assert.deepEqual(articles.map((article) => article.link), ["https://example.com/1"]);
});

test("builds equivalent Google and Bing queries with unique escaped geography and cutoff", () => {
  const input = {
    location: 'São "João"',
    region: 'São "João"',
    country: "Portugal",
    publishedAfter: CUTOFF,
  };
  const google = buildGoogleNewsQuery(input);
  const bing = buildBingNewsQuery(input);

  assert.ok(google.includes('("wildfire" OR "fire" OR "incêndio")'));
  assert.ok(google.includes('"São \\"João\\""'));
  assert.equal((google.match(/"São \\"João\\""/g) ?? []).length, 1);
  assert.ok(google.includes('"Portugal"'));
  assert.ok(google.includes("after:2026-08-01"));
  assert.equal(bing, google);
});

test("decodes XML entities and rejects an invalid cutoff", () => {
  assert.equal(decodeXml("A &amp; B &#x27; fogo"), "A & B ' fogo");
  assert.deepEqual(parseRssArticles("<rss><item></item></rss>", { publishedAfter: "nope" }), []);
});
