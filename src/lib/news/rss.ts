export interface NewsArticle {
  title: string;
  link: string;
  publishedAt: string;
  description?: string;
}

export interface RssFilterOptions {
  publishedAfter?: string;
  limit?: number;
  requireFireKeyword?: boolean;
}

export interface RssParseOptions extends RssFilterOptions {
  maxItems?: number;
}

export interface NewsQueryInput {
  location?: string | null;
  region?: string | null;
  country?: string | null;
  startedAt?: string | null;
  /** @deprecated Use startedAt for provider query inputs. */
  publishedAfter?: string | null;
}

export const DEFAULT_NEWS_LIMIT = 3;
export const DEFAULT_RSS_SCAN_LIMIT = 100;
export const NEWS_LOOKBACK_HOURS = 48;
const NEWS_LOOKBACK_MS = NEWS_LOOKBACK_HOURS * 60 * 60 * 1000;
export const FIRE_NEWS_QUERY = "(wildfire OR fire)";
const FIRE_KEYWORD_PATTERN = /\b(?:wildfires?|fires?|incendios?|incêndios?)\b/i;
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export function getEffectiveNewsCutoff(startedAt: string | null | undefined): string | null {
  if (!startedAt) return null;
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) return null;

  const effectiveCutoff = new Date(startedAtMs - NEWS_LOOKBACK_MS);
  return Number.isNaN(effectiveCutoff.getTime()) ? null : effectiveCutoff.toISOString();
}

export function decodeXml(value: string): string {
  const unwrapped = value.trim().replace(/^<!\[CDATA\[|\]\]>$/g, "");
  return unwrapped.replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]*);/gi, (entity, token: string) => {
    try {
      if (token.startsWith("#x") || token.startsWith("#X")) {
        const codePoint = Number.parseInt(token.slice(2), 16);
        return codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
      }
      if (token.startsWith("#")) {
        const codePoint = Number.parseInt(token.slice(1), 10);
        return codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
      }
      return NAMED_ENTITIES[token.toLowerCase()] ?? entity;
    } catch {
      return entity;
    }
  });
}

function readTag(itemXml: string, tag: string): string | null {
  const match = itemXml.match(new RegExp(`<(?:(?:[a-z0-9_-]+):)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:(?:[a-z0-9_-]+):)?${tag}>`, "i"));
  return match ? decodeXml(match[1]) : null;
}

function normalizeDescription(value: string | null): string | undefined {
  if (!value) return undefined;
  const description = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return description || undefined;
}

function normalizeHttpLink(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function parseArticle(itemXml: string): NewsArticle | null {
  const title = readTag(itemXml, "title")?.trim();
  const link = readTag(itemXml, "link");
  const publishedValue = readTag(itemXml, "pubDate")
    ?? readTag(itemXml, "published")
    ?? readTag(itemXml, "date");
  const publishedMs = Date.parse(publishedValue ?? "");
  const normalizedLink = link ? normalizeHttpLink(link) : null;
  if (!title || !normalizedLink || !Number.isFinite(publishedMs)) return null;

  const article: NewsArticle = {
    title,
    link: normalizedLink,
    publishedAt: new Date(publishedMs).toISOString(),
  };
  const description = normalizeDescription(readTag(itemXml, "description") ?? readTag(itemXml, "encoded"));
  if (description) article.description = description;
  return article;
}

function articleHasFireKeyword(article: NewsArticle): boolean {
  return FIRE_KEYWORD_PATTERN.test(`${article.title} ${article.description ?? ""}`);
}

/** Filter only after every RSS item has been parsed. */
export function filterRssArticles(
  articles: NewsArticle[],
  { publishedAfter, limit = DEFAULT_NEWS_LIMIT, requireFireKeyword = false }: RssFilterOptions = {},
): NewsArticle[] {
  const publishedAfterMs = publishedAfter == null ? null : Date.parse(publishedAfter);
  if (publishedAfter != null && !Number.isFinite(publishedAfterMs)) return [];

  const normalized = articles
    .map((article) => {
      const title = typeof article.title === "string" ? article.title.trim() : "";
      const link = typeof article.link === "string" ? normalizeHttpLink(article.link) : null;
      const publishedMs = typeof article.publishedAt === "string" ? Date.parse(article.publishedAt) : Number.NaN;
      if (!link || !title || !Number.isFinite(publishedMs)) return null;
      return {
        ...article,
        title,
        link,
        publishedAt: new Date(publishedMs).toISOString(),
      };
    })
    .filter((article): article is NewsArticle => article !== null)
    .filter((article) => {
      const publishedMs = Date.parse(article.publishedAt);
      return (publishedAfterMs === null || publishedMs >= publishedAfterMs)
        && (!requireFireKeyword || articleHasFireKeyword(article));
    });

  const deduped = new Map<string, NewsArticle>();
  for (const article of normalized) {
    const existing = deduped.get(article.link);
    if (!existing || Date.parse(article.publishedAt) > Date.parse(existing.publishedAt)) {
      deduped.set(article.link, article);
    }
  }

  const filtered = [...deduped.values()]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.link.localeCompare(b.link));

  return filtered.slice(0, Math.max(0, Math.floor(limit)));
}

/** Parse all valid RSS items, then apply the authoritative server-side filter. */
export function parseRssArticles(xml: string, options: RssParseOptions = {}): NewsArticle[] {
  const { maxItems = DEFAULT_RSS_SCAN_LIMIT, ...filterOptions } = options;
  const scanLimit = Number.isFinite(maxItems)
    ? Math.min(DEFAULT_RSS_SCAN_LIMIT, Math.max(0, Math.floor(maxItems)))
    : DEFAULT_RSS_SCAN_LIMIT;
  const parsed: NewsArticle[] = [];
  let scannedItems = 0;

  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    if (scannedItems >= scanLimit) break;
    scannedItems += 1;
    const article = parseArticle(match[1]);
    if (article) parsed.push(article);
  }

  return filterRssArticles(parsed, filterOptions);
}

function cleanGeographyTerm(value: string | null | undefined): string | null {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned || null;
}

/** Extract the most specific label while tolerating common composite formats
 * such as `Village / Municipality, Region, Country`. */
export function extractVillage(
  location: string | null | undefined,
  region: string | null | undefined,
  country: string | null | undefined,
): string | null {
  const cleanedLocation = cleanGeographyTerm(location);
  if (!cleanedLocation) return null;

  const parts = cleanedLocation
    .split(/\s*(?:\/|,|\||>|\u203a|\u2192)\s*/)
    .map(cleanGeographyTerm)
    .filter((term): term is string => term !== null);

  return parts[0] ?? cleanGeographyTerm(region) ?? cleanGeographyTerm(country) ?? cleanedLocation;
}

function quoteGeographyTerm(value: string | null): string | null {
  return value ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : null;
}

function joinQuery(parts: Array<string | null>): string {
  return parts.filter((part): part is string => part !== null).join(" ");
}

/** Ordered from highest precision to broadest national context. */
export function buildGoogleNewsQueries(input: NewsQueryInput): [string, string, string] {
  const village = extractVillage(input.location, input.region, input.country);
  const region = cleanGeographyTerm(input.region);
  const country = cleanGeographyTerm(input.country);
  const regionalScope = region ?? country ?? village;
  const nationalScope = country ?? region ?? village;

  return [
    joinQuery([
      quoteGeographyTerm(village),
      quoteGeographyTerm(region),
      quoteGeographyTerm(country),
      FIRE_NEWS_QUERY,
      "when:3d",
    ]),
    joinQuery([
      quoteGeographyTerm(regionalScope),
      region && country ? quoteGeographyTerm(country) : null,
      FIRE_NEWS_QUERY,
      "when:7d",
    ]),
    joinQuery([quoteGeographyTerm(nationalScope), FIRE_NEWS_QUERY]),
  ];
}

export function buildGoogleNewsQuery(input: NewsQueryInput): string {
  return buildGoogleNewsQueries(input)[0];
}

/** The network-error fallback starts with the same precision query. */
export function buildBingNewsQuery(input: NewsQueryInput): string {
  return buildGoogleNewsQuery(input);
}

export const buildNewsQuery = buildGoogleNewsQuery;
