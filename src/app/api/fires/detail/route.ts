import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { CachedFirmsPoint } from "@/lib/wildfire/firms-cache";
import { parseCsv, toPoint } from "@/lib/wildfire/firms-csv";

export const dynamic = "force-dynamic";

const FIRMS_BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const FIRMS_SOURCE = "VIIRS_SNPP_NRT";
const DETAIL_CACHE_TTL_SECONDS = 1_800; // 30 minutes
const MAX_BBOX_SPAN_DEGREES = 5;
const SAFETY_CAP_POINTS = 20_000;
const UPSTREAM_TIMEOUT_MS = 15_000;

const DETAIL_CACHE_HEADERS = {
  "Cache-Control": `public, max-age=${DETAIL_CACHE_TTL_SECONDS}, s-maxage=${DETAIL_CACHE_TTL_SECONDS}, stale-while-revalidate=3600`,
};
const DETAIL_ERROR_HEADERS = { "Cache-Control": "no-store" };

export interface FireDetailPayload {
  version: 1;
  source: "NASA FIRMS VIIRS_SNPP_NRT";
  generatedAt: string;
  bbox: [number, number, number, number];
  days: number;
  points: CachedFirmsPoint[];
}

interface DetailKvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface DetailEnv {
  FIRMS_CACHE: DetailKvNamespace;
  FIRMS_MAP_KEY: string;
}

class FirmsMapKeyMissingError extends Error {
  constructor() {
    super("FIRMS_MAP_KEY is not configured");
    this.name = "FirmsMapKeyMissingError";
  }
}

/**
 * Resolves the FIRMS map key from whichever source has it.
 *
 * Priority: Cloudflare binding (available in deployed Workers, where secrets
 * are attached to `env`) → process.env (available in `next dev`, where secrets
 * live in .env.local but the Cloudflare binding returns an empty string because
 * FIRMS_MAP_KEY is not declared in wrangler.jsonc vars).
 *
 * Trimmed and treated as absent when empty — prevents an accidental
 * whitespace-only value from reaching the NASA API call.
 */
export function resolveFirmsMapKey(bindingValue: string | undefined): string {
  const fromBinding = bindingValue?.trim();
  if (fromBinding) return fromBinding;
  return process.env.FIRMS_MAP_KEY?.trim() ?? "";
}

class FirmsUpstreamError extends Error {
  constructor(status: number) {
    super(`NASA FIRMS area request failed: ${status}`);
    this.name = "FirmsUpstreamError";
  }
}

function invalidRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400, headers: DETAIL_ERROR_HEADERS });
}

function parseFiniteCoord(value: string | null, min: number, max: number): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function parseDays(value: string | null): number | null {
  if (value === null) return 3;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) return null;
  return parsed;
}

function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildCacheKey(west: number, south: number, east: number, north: number, days: number): string {
  const rw = roundCoord(west);
  const rs = roundCoord(south);
  const re = roundCoord(east);
  const rn = roundCoord(north);
  return `fire-detail:v1:${rw},${rs},${re},${rn}:${days}`;
}

function buildAreaUrl(mapKey: string, west: number, south: number, east: number, north: number, days: number): string {
  const area = `${west},${south},${east},${north}`;
  return `${FIRMS_BASE_URL}/${encodeURIComponent(mapKey.trim())}/${FIRMS_SOURCE}/${area}/${days}`;
}

export async function handleFireDetailRequest(request: Request, env: DetailEnv): Promise<Response> {
  const url = new URL(request.url);
  const params = url.searchParams;

  const west = parseFiniteCoord(params.get("west"), -180, 180);
  const south = parseFiniteCoord(params.get("south"), -90, 90);
  const east = parseFiniteCoord(params.get("east"), -180, 180);
  const north = parseFiniteCoord(params.get("north"), -90, 90);
  const days = parseDays(params.get("days"));

  if (west === null) return invalidRequest("Invalid or missing parameter: west (must be -180..180)");
  if (south === null) return invalidRequest("Invalid or missing parameter: south (must be -90..90)");
  if (east === null) return invalidRequest("Invalid or missing parameter: east (must be -180..180)");
  if (north === null) return invalidRequest("Invalid or missing parameter: north (must be -90..90)");
  if (days === null) return invalidRequest("Invalid parameter: days (must be integer 1-10)");

  if (east <= west) return invalidRequest("Inverted or zero-width bbox: east must be greater than west");
  if (north <= south) return invalidRequest("Inverted or zero-height bbox: north must be greater than south");

  const spanLng = east - west;
  const spanLat = north - south;
  if (spanLng > MAX_BBOX_SPAN_DEGREES) {
    return invalidRequest(`Bbox too large: longitude span ${spanLng.toFixed(2)}° exceeds ${MAX_BBOX_SPAN_DEGREES}° limit`);
  }
  if (spanLat > MAX_BBOX_SPAN_DEGREES) {
    return invalidRequest(`Bbox too large: latitude span ${spanLat.toFixed(2)}° exceeds ${MAX_BBOX_SPAN_DEGREES}° limit`);
  }

  const mapKey = env.FIRMS_MAP_KEY?.trim();
  if (!mapKey) {
    return Response.json(
      { error: "Fire detail unavailable: upstream API key not configured" },
      { status: 503, headers: DETAIL_ERROR_HEADERS },
    );
  }

  const cacheKey = buildCacheKey(west, south, east, north, days);
  try {
    const cached = await env.FIRMS_CACHE.get(cacheKey);
    if (cached) {
      return new Response(cached, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...DETAIL_CACHE_HEADERS,
          "X-Wildfire-Source": "cloudflare-kv",
        },
      });
    }
  } catch {
    // KV read failure is non-fatal; proceed to fetch from NASA.
  }

  let csv: string;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const response = await fetch(
        buildAreaUrl(mapKey, west, south, east, north, days),
        { cache: "no-store", headers: { Accept: "text/csv" }, signal: controller.signal },
      );
      if (!response.ok) throw new FirmsUpstreamError(response.status);
      csv = await response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    if (error instanceof FirmsMapKeyMissingError) {
      return Response.json(
        { error: "Fire detail unavailable: upstream API key not configured" },
        { status: 503, headers: DETAIL_ERROR_HEADERS },
      );
    }
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`NASA FIRMS area fetch failed (${reason})`);
    return Response.json(
      { error: "Fire detail unavailable: upstream error" },
      { status: 502, headers: DETAIL_ERROR_HEADERS },
    );
  }

  let points: CachedFirmsPoint[];
  try {
    const { rows } = parseCsv(csv);
    // Apply safety cap — no downsampling or spatial selection on this path.
    const capped = rows.slice(0, SAFETY_CAP_POINTS);
    points = capped.map(toPoint);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`FIRMS area CSV parse failed (${reason})`);
    return Response.json(
      { error: "Fire detail unavailable: invalid upstream data" },
      { status: 502, headers: DETAIL_ERROR_HEADERS },
    );
  }

  const payload: FireDetailPayload = {
    version: 1,
    source: "NASA FIRMS VIIRS_SNPP_NRT",
    generatedAt: new Date().toISOString(),
    bbox: [west, south, east, north],
    days,
    points,
  };

  const body = JSON.stringify(payload);
  try {
    await env.FIRMS_CACHE.put(cacheKey, body, { expirationTtl: DETAIL_CACHE_TTL_SECONDS });
  } catch {
    // KV write failure is non-fatal; the response is still returned.
  }

  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...DETAIL_CACHE_HEADERS,
      "X-Wildfire-Source": "nasa-firms",
      "X-Wildfire-Point-Count": String(points.length),
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return handleFireDetailRequest(request, {
      FIRMS_CACHE: env.FIRMS_CACHE as unknown as DetailKvNamespace,
      // Binding is empty in `next dev` (secret not in wrangler.jsonc vars);
      // resolveFirmsMapKey falls back to process.env so local dev works too.
      FIRMS_MAP_KEY: resolveFirmsMapKey(env.FIRMS_MAP_KEY),
    });
  } catch (error) {
    console.error("Unable to obtain Cloudflare context for fire detail route", error);
    return Response.json({ error: "Fire detail unavailable" }, { status: 503, headers: DETAIL_ERROR_HEADERS });
  }
}
