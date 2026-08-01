export const dynamic = "force-dynamic";

interface NewsArticle {
  title: string;
  link: string;
  publishedAt: string;
}

function decodeXml(value: string): string {
  const unwrapped = value.trim().replace(/^<!\[CDATA\[|\]\]>$/g, "");
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };

  return unwrapped.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
    if (token.startsWith("#x")) return String.fromCodePoint(Number.parseInt(token.slice(2), 16));
    if (token.startsWith("#")) return String.fromCodePoint(Number.parseInt(token.slice(1), 10));
    return namedEntities[token.toLowerCase()] ?? entity;
  });
}

function readTag(itemXml: string, tag: string): string | null {
  const match = itemXml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXml(match[1]) : null;
}

function parseRssArticles(xml: string): NewsArticle[] {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .map((match): NewsArticle | null => {
      const itemXml = match[1];
      const title = readTag(itemXml, "title");
      const link = readTag(itemXml, "link");
      const publishedTime = Date.parse(readTag(itemXml, "pubDate") ?? "");
      const publishedAt = Number.isFinite(publishedTime) ? new Date(publishedTime).toISOString() : null;
      if (!title || !link || !publishedAt || !link.startsWith("https://")) return null;
      return { title, link, publishedAt };
    })
    .filter((article): article is NewsArticle => article !== null)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 3);
}
async function fetchArticles(endpoint: URL): Promise<NewsArticle[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9",
        "User-Agent": "WildfireWatch/1.0 (+https://wildfire-watch.duartemonteiro.workers.dev/)",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Google News request failed: ${response.status}`);
    return parseRssArticles(await response.text());
  } finally {
    clearTimeout(timeoutId);
  }
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
