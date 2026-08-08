import {
  buildBingNewsQuery,
  buildGoogleNewsQuery,
  getEffectiveNewsCutoff,
  parseRssArticles,
  type NewsArticle,
  type NewsQueryInput,
} from "@/lib/news/rss";

export const dynamic = "force-dynamic";

const NEWS_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600",
};

interface NewsRequest extends NewsQueryInput {
  location: string;
  region: string;
  country: string;
  startedAt: string;
  effectiveCutoff: string;
  locale: "pt" | "en";
}

function invalidRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

function buildGoogleEndpoint(request: NewsRequest): URL {
  const endpoint = new URL("https://news.google.com/rss/search");
  endpoint.search = new URLSearchParams({
    q: buildGoogleNewsQuery(request),
    hl: request.locale === "pt" ? "pt-PT" : "en-GB",
    gl: request.locale === "pt" ? "PT" : "GB",
    ceid: request.locale === "pt" ? "PT:pt-150" : "GB:en",
  }).toString();
  return endpoint;
}

function buildBingEndpoint(request: NewsRequest): URL {
  const endpoint = new URL("https://www.bing.com/news/search");
  endpoint.search = new URLSearchParams({
    q: buildBingNewsQuery(request),
    format: "rss",
    mkt: request.locale === "pt" ? "pt-PT" : "en-GB",
  }).toString();
  return endpoint;
}

async function fetchRssArticles(endpoint: URL, publishedAfter: string, timeoutMs: number): Promise<NewsArticle[]> {
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
    if (!response.ok) throw new Error(`News RSS request failed: ${response.status}`);
    return parseRssArticles(await response.text(), {
      publishedAfter,
      requireFireKeyword: true,
      limit: 3,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchArticles(endpoint: URL, request: NewsRequest, timeoutMs = 4_000): Promise<NewsArticle[]> {
  try {
    return await fetchRssArticles(endpoint, request.effectiveCutoff, timeoutMs);
  } catch (error) {
    if (endpoint.hostname !== "news.google.com") throw error;

    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.warn(`Google News RSS unavailable; using direct RSS fallback (${reason})`);
    return fetchRssArticles(buildBingEndpoint(request), request.effectiveCutoff, 6_000);
  }
}

function fallbackScopes(request: NewsRequest): NewsRequest[] {
  const locationParts = request.location
    .split(/[\/,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const regionalTerm = request.region || locationParts.at(-1) || request.country || request.location;
  const candidates: NewsRequest[] = [
    {
      ...request,
      location: regionalTerm,
      region: "",
    },
  ];
  if (request.country) {
    candidates.push({
      ...request,
      location: request.country,
      region: "",
      country: "",
    });
  }

  const originalKey = JSON.stringify([request.location, request.region, request.country]);
  const unique = new Map<string, NewsRequest>();
  for (const candidate of candidates) {
    const key = JSON.stringify([candidate.location, candidate.region, candidate.country]);
    if (key !== originalKey) unique.set(key, candidate);
  }
  return [...unique.values()];
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
  const effectiveCutoff = getEffectiveNewsCutoff(startedAt);
  if (!effectiveCutoff) return invalidRequest("Invalid startedAt");
  if (rawLocale !== null && rawLocale !== "pt" && rawLocale !== "en") return invalidRequest("Invalid locale");

  const newsRequest: NewsRequest = {
    location,
    region,
    country,
    startedAt,
    effectiveCutoff,
    locale: rawLocale === "pt" ? "pt" : "en",
  };

  try {
    let articles = await fetchArticles(buildGoogleEndpoint(newsRequest), newsRequest);
    if (articles.length === 0) {
      const fallbackRequests = fallbackScopes(newsRequest);
      for (const fallbackRequest of fallbackRequests) {
        articles = await fetchArticles(buildGoogleEndpoint(fallbackRequest), fallbackRequest);
        if (articles.length > 0) break;
      }

      if (articles.length === 0 && newsRequest.locale === "pt") {
        const englishScope = fallbackRequests.at(-1) ?? newsRequest;
        const englishRequest = { ...englishScope, locale: "en" as const };
        articles = await fetchArticles(buildGoogleEndpoint(englishRequest), englishRequest);
      }
    }

    return Response.json(
      { location, articles: articles.slice(0, 3) },
      { headers: NEWS_CACHE_HEADERS },
    );
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`Local wildfire news lookup failed (${reason})`);
    return Response.json({ error: "News unavailable" }, { status: 502 });
  }
}
