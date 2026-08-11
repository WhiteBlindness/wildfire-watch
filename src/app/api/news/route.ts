import {
  buildGoogleNewsQueries,
  getEffectiveNewsCutoff,
  parseRssArticles,
  type NewsArticle,
  type NewsQueryInput,
} from "@/lib/news/rss";

export const dynamic = "force-dynamic";

const NEWS_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600",
};
const NEWS_ERROR_HEADERS = { "Cache-Control": "no-store" };
const NEWS_REQUEST_TIMEOUT_MS = 10_000;
const NEWS_RSS_MAX_BYTES = 256 * 1024;

interface NewsRequest extends NewsQueryInput {
  location: string;
  region: string;
  country: string;
  startedAt: string;
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
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9",
        "User-Agent": "Mozilla/5.0 (compatible; WildfireWatch/1.0)",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new NewsRssHttpError(response.status);
    return parseRssArticles(await readLimitedResponseText(response), {
      requireFireKeyword: true,
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

function errorReason(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
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
    console.warn(`Google News RSS unavailable; using direct RSS fallback (${errorReason(googleError)})`);
    try {
      const articles = await fetchRssArticles(
        buildBingEndpoint(request, query),
        getRemainingTimeout(deadlineAt, 6_000),
      );
      return { articles, receivedResponse: true };
    } catch (bingError) {
      console.warn(`Bing News RSS fallback unavailable (${errorReason(bingError)})`);
      return { articles: [], receivedResponse: false, error: bingError };
    }
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const location = url.searchParams.get("location")?.trim() ?? "";
  const region = url.searchParams.get("region")?.trim() ?? "";
  const country = url.searchParams.get("country")?.trim() ?? "";
  const startedAt = url.searchParams.get("startedAt")?.trim() ?? "";
  const rawLocale = url.searchParams.get("locale");

  if (location.length < 2 || location.length > 120) return invalidRequest("Invalid location");
  if (region.length > 120 || country.length > 120) return invalidRequest("Invalid geography");
  if (!getEffectiveNewsCutoff(startedAt)) return invalidRequest("Invalid startedAt");
  if (rawLocale !== null && rawLocale !== "pt" && rawLocale !== "en") return invalidRequest("Invalid locale");

  const newsRequest: NewsRequest = {
    location,
    region,
    country,
    startedAt,
    locale: rawLocale === "pt" ? "pt" : "en",
  };

  try {
    const deadlineAt = Date.now() + NEWS_REQUEST_TIMEOUT_MS;
    let receivedResponse = false;
    let lastError: unknown;
    for (const query of buildGoogleNewsQueries(newsRequest)) {
      const result = await fetchQueryTier(query, newsRequest, deadlineAt);
      receivedResponse ||= result.receivedResponse;
      lastError = result.error ?? lastError;
      if (result.articles.length > 0) {
        return Response.json(
          { location, articles: result.articles.slice(0, 3) },
          { headers: NEWS_CACHE_HEADERS },
        );
      }
    }

    if (!receivedResponse && lastError) throw lastError;
    return Response.json(
      { location, articles: [] },
      { headers: NEWS_CACHE_HEADERS },
    );
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`Local wildfire news lookup failed (${reason})`);
    return Response.json({ error: "News unavailable" }, { status: 502, headers: NEWS_ERROR_HEADERS });
  }
}
