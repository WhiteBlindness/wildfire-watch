import { XMLParser } from "fast-xml-parser";

export const dynamic = "force-dynamic";

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: false,
});

interface RssItem {
  title?: string;
  link?: string;
  pubDate?: string;
}

interface RssPayload {
  rss?: {
    channel?: {
      item?: RssItem | RssItem[];
    };
  };
}

interface NewsArticle {
  title: string;
  link: string;
  publishedAt: string;
}

async function fetchArticles(endpoint: URL): Promise<NewsArticle[]> {
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/rss+xml, application/xml;q=0.9",
      "User-Agent": "WildfireWatch/1.0 (+https://wildfire-watch.duartemonteiro.workers.dev/)",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Google News request failed: ${response.status}`);

  const payload = parser.parse(await response.text()) as RssPayload;
  const rawItems = payload.rss?.channel?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  return items
    .map((item): NewsArticle | null => {
      const title = typeof item.title === "string" ? item.title.trim() : null;
      const link = typeof item.link === "string" ? item.link.trim() : null;
      const publishedTime = typeof item.pubDate === "string" ? Date.parse(item.pubDate) : Number.NaN;
      const publishedAt = Number.isFinite(publishedTime) ? new Date(publishedTime).toISOString() : null;
      if (!title || !link || !publishedAt || !link.startsWith("https://")) return null;
      return { title, link, publishedAt };
    })
    .filter((article): article is NewsArticle => article !== null)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 3);
}
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const location = url.searchParams.get("location")?.trim() ?? "";
  const locale = url.searchParams.get("locale") === "pt" ? "pt" : "en";

  if (location.length < 2 || location.length > 120) {
    return Response.json({ error: "Invalid location" }, { status: 400 });
  }

  const endpoint = new URL("https://news.google.com/rss/search");
  endpoint.search = new URLSearchParams({
    q: `("wildfire" OR "fire") "${location}"`,
    hl: locale === "pt" ? "pt-PT" : "en-GB",
    gl: locale === "pt" ? "PT" : "GB",
    ceid: locale === "pt" ? "PT:pt-150" : "GB:en",
  }).toString();

  try {
    let articles = await fetchArticles(endpoint);
    if (articles.length === 0) {
      const fallbackEndpoint = new URL(endpoint);
      const regionalTerm = location.split(",")[0].split("/").at(-1)?.trim() || location;
      fallbackEndpoint.searchParams.set("q", `${locale === "pt" ? "incêndio" : "wildfire"} ${regionalTerm}`);
      articles = await fetchArticles(fallbackEndpoint);

      if (articles.length === 0 && locale === "pt") {
        fallbackEndpoint.searchParams.set("q", `wildfire ${regionalTerm}`);
        fallbackEndpoint.searchParams.set("hl", "en-US");
        fallbackEndpoint.searchParams.set("gl", "US");
        fallbackEndpoint.searchParams.set("ceid", "US:en");
        articles = await fetchArticles(fallbackEndpoint);
      }
    }

    return Response.json(
      { location, articles },
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600" } },
    );
  } catch (error) {
    console.error("Local wildfire news lookup failed", error);
    return Response.json({ error: "News unavailable" }, { status: 502 });
  }
}
