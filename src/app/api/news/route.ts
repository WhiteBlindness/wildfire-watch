import {
  buildGoogleNewsQueries,
  newsCutoff,
  parseRssArticles,
  type NewsArticle,
  type NewsQueryInput,
} from "@/lib/news/rss";
import {
  UpstreamBusyError,
  createGuardedLookup,
  edgeCachedInit,
  errorName,
  guardedLookup,
  upstreamBusyResponse,
} from "@/lib/server/upstream-guard";

export const dynamic = "force-dynamic";

const NEWS_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
};
const NEWS_ERROR_HEADERS = { "Cache-Control": "no-store" };
const NEWS_REQUEST_TIMEOUT_MS = 10_000;
const NEWS_RSS_MAX_BYTES = 256 * 1024;
const NEWS_CACHE_MS = 15 * 60 * 1_000;
const EDGE_CACHE_SECONDS = 15 * 60;
const MAX_LOCATION_LENGTH = 100;
const MAX_AREA_LENGTH = 60;
/**
 * Place names as the reverse geocoder writes them: letters in any script,
 * digits, spaces and the separators it uses. Anything else is not a place name.
 */
const PLACE_NAME_PATTERN = /^[\p{L}\p{M}\p{N} ,.'’()/-]+$/u;

/**
 * One lookup can make up to six RSS requests (three query tiers, each with a
 * fallback), so results are cached by normalised place and the number of new
 * lookups per isolate is capped. Google and Bing throttle shared egress
 * addresses; amplifying a burst would get the feeds blocked for every visitor.
 */
const lookups = createGuardedLookup<NewsArticle[]>({
  maxEntries: 300,
  ttlMs: NEWS_CACHE_MS,
  budgetLimit: 12,
  budgetWindowMs: 60_000,
});

interface NewsRequest extends NewsQueryInput {
  location: string;
  region: string;
  country: string;
  locale: "pt" | "en";
}

class NewsRssHttpError extends Error {
  constructor(status: number) {
    super(`News RSS request failed: ${status}`);
    this.name = "NewsRssHttpError";
  }
}

class NewsRssPayloadTooLargeError extends Error {
  constructor() {
    super("News RSS payload exceeded the configured limit");
    this.name = "NewsRssPayloadTooLargeError";
  }
}

class NewsRequestDeadlineError extends Error {
  constructor() {
    super("News lookup exceeded the overall deadline");
    this.name = "NewsRequestDeadlineError";
  }
}

function invalidRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400, headers: NEWS_ERROR_HEADERS });
}

function buildProviderEndpoint(baseUrl: string, query: string, parameters: Record<string, string>): URL {
  const endpoint = new URL(baseUrl);
  const providerParameters = new URLSearchParams(parameters).toString();
  endpoint.search = `q=${encodeURIComponent(query)}${providerParameters ? `&${providerParameters}` : ""}`;
  return endpoint;
}

function buildGoogleEndpoint(request: NewsRequest, query: string): URL {
  return buildProviderEndpoint("https://news.google.com/rss/search", query, {
    hl: request.locale === "pt" ? "pt-PT" : "en-GB",
    gl: request.locale === "pt" ? "PT" : "GB",
    ceid: request.locale === "pt" ? "PT:pt-150" : "GB:en",
  });
}

function buildBingEndpoint(request: NewsRequest, query: string): URL {
  return buildProviderEndpoint("https://www.bing.com/news/search", query, {
    format: "rss",
    mkt: request.locale === "pt" ? "pt-PT" : "en-GB",
  });
}

async function fetchRssArticles(endpoint: URL, timeoutMs: number): Promise<NewsArticle[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, edgeCachedInit({
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9",
        "User-Agent": "Mozilla/5.0 (compatible; WildfireWatch/1.0)",
      },
      signal: controller.signal,
    }, EDGE_CACHE_SECONDS));
    if (!response.ok) throw new NewsRssHttpError(response.status);
    return parseRssArticles(await readLimitedResponseText(response), {
      requireFireKeyword: true,
      publishedAfter: newsCutoff(Date.now()),
      limit: 3,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readLimitedResponseText(response: Response): Promise<string> {
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > NEWS_RSS_MAX_BYTES) {
    throw new NewsRssPayloadTooLargeError();
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > NEWS_RSS_MAX_BYTES) {
      throw new NewsRssPayloadTooLargeError();
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    totalBytes += value.byteLength;
    if (totalBytes > NEWS_RSS_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new NewsRssPayloadTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
}

interface TierFetchResult {
  articles: NewsArticle[];
  receivedResponse: boolean;
  error?: unknown;
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && error.name === "AbortError");
}

function getRemainingTimeout(deadlineAt: number, providerTimeoutMs: number): number {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) throw new NewsRequestDeadlineError();
  return Math.min(providerTimeoutMs, remainingMs);
}

async function fetchQueryTier(
  query: string,
  request: NewsRequest,
  deadlineAt: number,
): Promise<TierFetchResult> {
  try {
    const articles = await fetchRssArticles(
      buildGoogleEndpoint(request, query),
      getRemainingTimeout(deadlineAt, 4_000),
    );
    return { articles, receivedResponse: true };
  } catch (googleError) {
    if (!isNetworkError(googleError)) throw googleError;
    console.warn(`Google News RSS unavailable; using the Bing RSS fallback (${errorName(googleError)})`);
    try {
      const articles = await fetchRssArticles(
        buildBingEndpoint(request, query),
        getRemainingTimeout(deadlineAt, 6_000),
      );
      return { articles, receivedResponse: true };
    } catch (bingError) {
      console.warn(`Bing News RSS fallback unavailable (${errorName(bingError)})`);
      return { articles: [], receivedResponse: false, error: bingError };
    }
  }
}

/** Collapses whitespace; returns null for text that is too long or not a place name. */
function readPlace(value: string | null, maxLength: number): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length > maxLength) return null;
  if (text && !PLACE_NAME_PATTERN.test(text)) return null;
  return text;
}

async function searchNews(newsRequest: NewsRequest): Promise<NewsArticle[]> {
  const deadlineAt = Date.now() + NEWS_REQUEST_TIMEOUT_MS;
  let receivedResponse = false;
  let lastError: unknown;
  for (const query of buildGoogleNewsQueries(newsRequest)) {
    const result = await fetchQueryTier(query, newsRequest, deadlineAt);
    receivedResponse ||= result.receivedResponse;
    lastError = result.error ?? lastError;
    if (result.articles.length > 0) return result.articles.slice(0, 3);
  }
  if (!receivedResponse && lastError) throw lastError;
  return [];
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const location = readPlace(url.searchParams.get("location"), MAX_LOCATION_LENGTH);
  const region = readPlace(url.searchParams.get("region"), MAX_AREA_LENGTH);
  const country = readPlace(url.searchParams.get("country"), MAX_AREA_LENGTH);
  const rawLocale = url.searchParams.get("locale");

  if (location === null || location.length < 2) return invalidRequest("Invalid location");
  if (region === null || country === null) return invalidRequest("Invalid geography");
  if (rawLocale !== null && rawLocale !== "pt" && rawLocale !== "en") return invalidRequest("Invalid locale");

  const newsRequest: NewsRequest = { location, region, country, locale: rawLocale === "pt" ? "pt" : "en" };
  const key = [newsRequest.locale, location, region, country].join("|").toLocaleLowerCase("und");

  try {
    const { value: articles } = await guardedLookup(lookups, key, () => searchNews(newsRequest));
    return Response.json({ location, articles }, { headers: NEWS_CACHE_HEADERS });
  } catch (error) {
    if (error instanceof UpstreamBusyError) return upstreamBusyResponse(error);
    console.error(`Local wildfire news lookup failed (${errorName(error)})`);
    return Response.json({ error: "News unavailable" }, { status: 502, headers: NEWS_ERROR_HEADERS });
  }
}
