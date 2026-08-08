import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBingNewsQuery,
  buildGoogleNewsQuery,
  decodeXml,
  filterRssArticles,
  getEffectiveNewsCutoff,
  parseRssArticles,
} from "./rss";

const STARTED_AT = "2026-08-01T12:00:00.000Z";
const EFFECTIVE_CUTOFF = "2026-07-30T12:00:00.000Z";

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

test("relaxes the acquisition cutoff by 48 hours and rejects invalid RSS fields", () => {
  const xml = `<rss><channel>
    ${item({ title: "Too old fire", link: "https://example.com/old", publishedAt: "2026-07-30T11:59:59.000Z" })}
    ${item({ title: "Boundary fire", link: "https://example.com/boundary", publishedAt: EFFECTIVE_CUTOFF })}
    ${item({ title: "Started fire", link: "https://example.com/started", publishedAt: STARTED_AT })}
    ${item({ title: "Invalid link", link: "javascript:alert(1)", publishedAt: "2026-08-02T01:00:00.000Z" })}
    ${item({ title: "Invalid date", link: "https://example.com/date", publishedAt: "not a date" })}
  </channel></rss>`;

  assert.equal(getEffectiveNewsCutoff(STARTED_AT), EFFECTIVE_CUTOFF);
  assert.deepEqual(
    parseRssArticles(xml, { publishedAfter: getEffectiveNewsCutoff(STARTED_AT)!, requireFireKeyword: true }).map((article) => article.link),
    ["https://example.com/started", "https://example.com/boundary"],
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
    parseRssArticles(xml, { publishedAfter: EFFECTIVE_CUTOFF, limit: 3 }).map((article) => article.link),
    ["https://example.com/1", "https://example.com/2", "https://example.com/4"],
  );
});

test("requires a fire keyword across title or description when requested", () => {
  const articles = filterRssArticles([
    { title: "Local bulletin", description: "A wildfire is burning nearby", link: "https://example.com/1", publishedAt: EFFECTIVE_CUTOFF },
    { title: "Local football", description: "Match report", link: "https://example.com/2", publishedAt: EFFECTIVE_CUTOFF },
    { title: "Incêndios florestais na Europa", link: "https://example.com/3", publishedAt: EFFECTIVE_CUTOFF },
  ], { publishedAfter: EFFECTIVE_CUTOFF, requireFireKeyword: true });

  assert.deepEqual(articles.map((article) => article.link), ["https://example.com/1", "https://example.com/3"]);
});

test("builds equivalent scoped Google and Bing queries with a relaxed cutoff", () => {
  const input = {
    location: "Covilhã/Castelo Branco, Portugal",
    region: "Covilhã",
    country: "Portugal",
    startedAt: STARTED_AT,
  };
  const google = buildGoogleNewsQuery(input);
  const bing = buildBingNewsQuery(input);

  assert.ok(google.includes("(wildfire OR fire OR incêndio)"));
  assert.equal(google, '(wildfire OR fire OR incêndio) "Covilhã" after:2026-07-30');
  assert.ok(!google.includes("Castelo Branco"));
  assert.ok(!google.includes('"Portugal"'));
  assert.equal(bing, google);
});

test("decodes XML entities and rejects an invalid cutoff", () => {
  assert.equal(decodeXml("A &amp; B &#x27; fogo"), "A & B ' fogo");
  assert.deepEqual(parseRssArticles("<rss><item></item></rss>", { publishedAfter: "nope" }), []);
});
