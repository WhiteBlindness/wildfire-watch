import { SITE } from "@/lib/site";
import {
  UpstreamBusyError,
  createGuardedLookup,
  edgeCachedInit,
  errorName,
  guardedLookup,
  quantize,
  upstreamBusyResponse,
} from "@/lib/server/upstream-guard";

export const dynamic = "force-dynamic";

/**
 * Nearest place name for a detection, from OpenStreetMap Nominatim.
 *
 * Nominatim's usage policy allows at most one request per second for the whole
 * application and requires results to be cached. Coordinates are rounded to
 * about 2 km (the lookup is at municipality level anyway), so nearby
 * detections share one result. Lookups are cached in memory and at the edge,
 * serialised one per second per isolate, and capped per minute. Nothing is
 * written to KV: its free daily write quota is reserved for the ingest.
 */
const COORDINATE_STEP_DEGREES = 0.02;
const REQUEST_INTERVAL_MS = 1_100;
const MAX_QUEUED_LOOKUPS = 4;
const UPSTREAM_TIMEOUT_MS = 6_000;
const EDGE_CACHE_SECONDS = 7 * 24 * 60 * 60;
const SUCCESS_HEADERS = { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" };
const ERROR_HEADERS = { "Cache-Control": "no-store" };

const lookups = createGuardedLookup<string>({
  maxEntries: 1_000,
  ttlMs: 24 * 60 * 60 * 1_000,
  budgetLimit: 30,
  budgetWindowMs: 60_000,
});
let queue: Promise<void> = Promise.resolve();
let queued = 0;

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  country?: string;
}

class NominatimError extends Error {
  constructor(readonly status: number | null) {
    super(status === null ? "Nominatim returned no country" : `Nominatim request failed: ${status}`);
    this.name = "NominatimError";
  }
}

export function formatPlaceLabel(address: NominatimAddress | undefined): string | null {
  if (!address?.country) return null;
  const locality = address.city ?? address.town ?? address.village ?? address.municipality ?? address.county ?? address.state;
  const region = address.state ?? address.county;
  const place = [locality, region && region !== locality ? region : null].filter(Boolean).join("/");
  return place ? `${place}, ${address.country}` : address.country;
}

function buildNominatimUrl(lat: number, lon: number, locale: "pt" | "en"): URL {
  const endpoint = new URL("https://nominatim.openstreetmap.org/reverse");
  endpoint.search = new URLSearchParams({
    lat: lat.toFixed(2),
    lon: lon.toFixed(2),
    format: "jsonv2",
    zoom: "10",
    addressdetails: "1",
    layer: "address",
    "accept-language": locale === "pt" ? "pt-PT,pt,en" : "en-GB,en",
  }).toString();
  return endpoint;
}

async function fetchPlaceLabel(lat: number, lon: number, locale: "pt" | "en"): Promise<string> {
  const response = await fetch(buildNominatimUrl(lat, lon, locale), edgeCachedInit({
    headers: {
      Accept: "application/json",
      // The policy asks for an identifying User-Agent with a way to reach the operator.
      "User-Agent": `WildfireWatch/1.0 (+${SITE.url}; ${SITE.contactUrl})`,
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  }, EDGE_CACHE_SECONDS));
  if (!response.ok) throw new NominatimError(response.status);
  const label = formatPlaceLabel(((await response.json()) as { address?: NominatimAddress }).address);
  if (!label) throw new NominatimError(null);
  return label;
}

/** One upstream call at a time per isolate, spaced by the policy interval; refuses a long queue. */
function throttled<T>(task: () => Promise<T>): Promise<T> {
  if (queued >= MAX_QUEUED_LOOKUPS) return Promise.reject(new UpstreamBusyError(Math.ceil((queued * REQUEST_INTERVAL_MS) / 1_000)));
  queued += 1;
  const run = queue.then(task);
  const release = () => new Promise<void>((resolve) => setTimeout(() => { queued -= 1; resolve(); }, REQUEST_INTERVAL_MS));
  queue = run.then(release, release);
  return run;
}

function parseCoordinate(value: string | null, limit: number): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : null;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const lat = parseCoordinate(url.searchParams.get("lat"), 90);
  const lon = parseCoordinate(url.searchParams.get("lon"), 180);
  const locale = url.searchParams.get("locale") === "en" ? "en" : "pt";
  if (lat === null || lon === null) {
    return Response.json({ error: "Invalid coordinates" }, { status: 400, headers: ERROR_HEADERS });
  }

  const qLat = quantize(lat, COORDINATE_STEP_DEGREES);
  const qLon = quantize(lon, COORDINATE_STEP_DEGREES);
  try {
    const { value: label } = await guardedLookup(lookups, `${qLat}:${qLon}:${locale}`, () => throttled(() => fetchPlaceLabel(qLat, qLon, locale)));
    return Response.json({ label }, { headers: SUCCESS_HEADERS });
  } catch (error) {
    if (error instanceof UpstreamBusyError) return upstreamBusyResponse(error);
    const status = error instanceof NominatimError ? error.status : null;
    console.warn(`Reverse geocoding failed (${errorName(error)}${status ? ` ${status}` : ""})`);
    return Response.json({ error: "Location name unavailable" }, { status: 502, headers: ERROR_HEADERS });
  }
}
