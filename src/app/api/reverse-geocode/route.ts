import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

const REQUEST_INTERVAL_MS = 1_100;
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
let reverseGeocodeQueue: Promise<void> = Promise.resolve();

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  country?: string;
}

interface NominatimResponse {
  address?: NominatimAddress;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const locale = url.searchParams.get("locale") === "en" ? "en" : "pt";

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return Response.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  const endpoint = new URL("https://nominatim.openstreetmap.org/reverse");
  endpoint.search = new URLSearchParams({
    lat: lat.toFixed(5),
    lon: lon.toFixed(5),
    format: "jsonv2",
    zoom: "10",
    addressdetails: "1",
    layer: "address",
    "accept-language": locale === "pt" ? "pt-PT,pt,en" : "en-GB,en",
  }).toString();

  const cacheKey = `reverse-geocode:v1:${lat.toFixed(4)}:${lon.toFixed(4)}:${locale}`;

  try {
    const { env } = await getCloudflareContext({ async: true });
    const cachedLabel = await env.FIRMS_CACHE.get(cacheKey);
    if (cachedLabel) {
      return Response.json({ label: cachedLabel }, {
        headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" },
      });
    }

    const lookup = reverseGeocodeQueue.then(async () => {
      // A preceding request may have populated the shared KV while this one
      // waited, so avoid an unnecessary upstream call.
      const queuedCachedLabel = await env.FIRMS_CACHE.get(cacheKey);
      if (queuedCachedLabel) return queuedCachedLabel;

      const response = await fetch(endpoint, {
        headers: {
          Accept: "application/json",
          "User-Agent": "WildfireWatch/1.0 (+https://wildfire-watch.duartemonteiro.workers.dev/)",
        },
      });
      if (!response.ok) throw new Error(`Nominatim request failed: ${response.status}`);

      const payload = await response.json() as NominatimResponse;
      const address = payload.address;
      if (!address?.country) throw new Error("Nominatim returned no country");

      const locality = address.city ?? address.town ?? address.village ?? address.municipality ?? address.county ?? address.state;
      const region = address.state ?? address.county;
      const place = [locality, region && region !== locality ? region : null].filter(Boolean).join("/");
      const label = place ? `${place}, ${address.country}` : address.country;
      await env.FIRMS_CACHE.put(cacheKey, label, { expirationTtl: CACHE_TTL_SECONDS });
      return label;
    });
    reverseGeocodeQueue = lookup.then(
      () => new Promise<void>((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS)),
      () => new Promise<void>((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS)),
    );
    const label = await lookup;

    return Response.json(
      { label },
      {
        headers: {
          "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
        },
      },
    );
  } catch (error) {
    console.error("Reverse geocoding failed", error);
    return Response.json({ error: "Location name unavailable" }, { status: 502 });
  }
}
