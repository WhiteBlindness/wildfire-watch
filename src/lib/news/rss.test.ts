import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBingNewsQuery,
  buildGoogleNewsQuery,
  buildGoogleNewsQueries,
  decodeXml,
  extractVillage,
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

test("extracts the village from composite location labels", () => {
  assert.equal(
    extractVillage("Pardieiros / Arganil, Coimbra, Portugal", "Coimbra", "Portugal"),
    "Pardieiros",
  );
  assert.equal(
    extractVillage("Covilhã/Castelo Branco, Portugal", "Castelo Branco", "Portugal"),
    "Covilhã",
  );
  assert.equal(
    extractVillage("Covilhã/Castelo Branco, Portugal", "Covilhã", "Portugal"),
    "Covilhã",
  );
  assert.equal(extractVillage("Leiria", "Leiria", "Portugal"), "Leiria");
});

test("builds the exact three Google News relaxation tiers", () => {
  const input = {
    location: "Pardieiros / Arganil, Coimbra, Portugal",
    region: "Coimbra",
    country: "Portugal",
    startedAt: STARTED_AT,
  };

  assert.deepEqual(buildGoogleNewsQueries(input), [
    '"Pardieiros" "Coimbra" "Portugal" (wildfire OR fire) when:3d',
    '"Coimbra" "Portugal" (wildfire OR fire) when:7d',
    '"Portugal" (wildfire OR fire)',
  ]);
  assert.equal(buildGoogleNewsQuery(input), buildGoogleNewsQueries(input)[0]);
  assert.equal(buildBingNewsQuery(input), buildGoogleNewsQueries(input)[0]);
});

test("decodes XML entities and rejects an invalid cutoff", () => {
  assert.equal(decodeXml("A &amp; B &#x27; fogo"), "A & B ' fogo");
  assert.deepEqual(parseRssArticles("<rss><item></item></rss>", { publishedAfter: "nope" }), []);
});

test("caps RSS item scanning before sorting and limiting results", () => {
  const items = Array.from({ length: 101 }, (_, index) => item({
    title: `Fire update ${index}`,
    link: `https://example.com/${index}`,
    publishedAt: new Date(Date.UTC(2026, 7, 1) + index * 60_000).toISOString(),
  }));

  assert.deepEqual(
    parseRssArticles(`<rss><channel>${items.join("")}</channel></rss>`).map((article) => article.link),
    ["https://example.com/99", "https://example.com/98", "https://example.com/97"],
  );
});

test("handles alternate RSS metadata and malformed optional fields safely", () => {
  const xml = `<rss><channel>
    <item><title>Atom wildfire</title><link>https://example.com/atom</link><published>2026-08-03T00:00:00.000Z</published><description><![CDATA[<p>Fire response</p>]]></description></item>
    <item><title>Dated fire</title><link>https://example.com/dated</link><date>2026-08-02T00:00:00.000Z</date><encoded><![CDATA[<strong>Wildfire bulletin</strong>]]></encoded></item>
    <item><title>Broken link fire</title><link>not-a-url</link><pubDate>2026-08-04T00:00:00.000Z</pubDate></item>
  </channel></rss>`;

  assert.deepEqual(
    parseRssArticles(xml, { requireFireKeyword: true, maxItems: Number.NaN }).map((article) => article.link),
    ["https://example.com/atom", "https://example.com/dated"],
  );
  assert.equal(decodeXml("&#x110000; &#1114112; &madeup;"), "&#x110000; &#1114112; &madeup;");
});

test("builds safe keyword-only tiers when geography is unavailable", () => {
  assert.equal(extractVillage(null, null, null), null);
  assert.deepEqual(buildGoogleNewsQueries({}), [
    "(wildfire OR fire) when:3d",
    "(wildfire OR fire) when:7d",
    "(wildfire OR fire)",
  ]);
});
