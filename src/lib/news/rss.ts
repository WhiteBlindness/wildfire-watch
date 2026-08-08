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

export interface NewsQueryInput {
  location?: string | null;
  region?: string | null;
  country?: string | null;
  publishedAfter?: string | null;
}

export const DEFAULT_NEWS_LIMIT = 3;
export const FIRE_NEWS_QUERY = '("wildfire" OR "fire" OR "incêndio")';
const FIRE_KEYWORD_PATTERN = /\b(?:wildfire|fire|incendio|incêndio)\b/i;
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

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
export function parseRssArticles(xml: string, options: RssFilterOptions = {}): NewsArticle[] {
  const parsed = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .map((match) => parseArticle(match[1]))
    .filter((article): article is NewsArticle => article !== null);
  return filterRssArticles(parsed, options);
}

function uniqueQueryTerms(input: NewsQueryInput): string[] {
  const seen = new Set<string>();
  return [input.location, input.region, input.country]
    .map((term) => term?.trim() ?? "")
    .filter((term) => term.length > 0)
    .filter((term) => {
      const key = term.toLocaleLowerCase("en");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((term) => `"${term.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
}

function afterDate(publishedAfter: string | null | undefined): string | null {
  if (!publishedAfter) return null;
  const parsed = Date.parse(publishedAfter);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function buildProviderQuery(input: NewsQueryInput): string {
  const terms = uniqueQueryTerms(input);
  const date = afterDate(input.publishedAfter);
  return [FIRE_NEWS_QUERY, ...terms, date ? `after:${date}` : null]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

export function buildGoogleNewsQuery(input: NewsQueryInput): string {
  return buildProviderQuery(input);
}

/** Bing accepts the same Boolean keyword group; unlike the old fallback, keep
 * the group and the cutoff in the provider query and enforce them again after
 * parsing the response. */
export function buildBingNewsQuery(input: NewsQueryInput): string {
  return buildProviderQuery(input);
}

export const buildNewsQuery = buildGoogleNewsQuery;
