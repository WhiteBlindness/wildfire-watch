import {
  FIRMS_CACHE_KEY,
  isGlobalFirmsCachePayload,
  type CachedFirmsPoint,
  type FirmsCachePayload,
} from "../src/lib/wildfire/firms-cache";

const FIRMS_BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const FIRMS_SOURCE = "VIIRS_SNPP_NRT";
const FIRMS_DAY_RANGE = 3;
const FIRMS_AREA = "world";
const FIRMS_TIMESTAMP_FUTURE_TOLERANCE_MS = 6 * 60 * 60 * 1000;
const MAX_POINTS = 6_000;
const PRIORITY_POINTS = 1_500;
const GRID_CELL_DEGREES = 2;

export interface FirmsIngestEnv {
  FIRMS_CACHE: FirmsKvNamespace;
  FIRMS_MAP_KEY: string;
}

interface FirmsKvNamespace {
  get(key: string): Promise<string | null>;
  get<T>(key: string, type: "json"): Promise<T | null>;
  put(key: string, value: string): Promise<void>;
}

export interface ParsedRow {
  lat: number;
  lng: number;
  frpMw: number;
  confidencePct: number;
  detectedAt: string;
}

function parseConfidence(raw: string): number {
  const value = raw.trim().toLowerCase();
  if (value === "l" || value === "low") return 30;
  if (value === "n" || value === "nominal") return 65;
  if (value === "h" || value === "high") return 90;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function toTimestamp(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return null;
  const hhmm = time.trim().padStart(4, "0");
  if (!/^\d{4}$/.test(hhmm)) return null;

  const [year, month, day] = date.trim().split("-").map(Number);
  const hours = Number(hhmm.slice(0, 2));
  const minutes = Number(hhmm.slice(2, 4));
  if (hours > 23 || minutes > 59) return null;

  const timestamp = Date.UTC(year, month - 1, day, hours, minutes);
  const parsed = new Date(timestamp);
  // Date.UTC normalizes impossible dates (for example, 31 February), so
  // compare the UTC components back to the source fields before accepting it.
  if (parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
    || timestamp > Date.now() + FIRMS_TIMESTAMP_FUTURE_TOLERANCE_MS) {
    return null;
  }
  return parsed.toISOString();
}

/**
 * Omit FIRMS' optional DATE segment. The API then selects the most recent
 * available NRT snapshot; deriving "today" in local time can request a
 * future GMT date around midnight. `world` is deliberately unrestricted.
 */
export function buildFirmsWorldUrl(mapKey: string): string {
  return `${FIRMS_BASE_URL}/${encodeURIComponent(mapKey.trim())}/${FIRMS_SOURCE}/${FIRMS_AREA}/${FIRMS_DAY_RANGE}`;
}

export function parseCsv(csv: string): { sourceRows: number; rows: ParsedRow[] } {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return { sourceRows: 0, rows: [] };

  const header = lines[0].split(",").map((cell) => cell.trim().toLowerCase());
  const indexOf = (name: string) => header.indexOf(name);
  const latIndex = indexOf("latitude");
  const lngIndex = indexOf("longitude");
  const frpIndex = indexOf("frp");
  const confidenceIndex = indexOf("confidence");
  const dateIndex = indexOf("acq_date");
  const timeIndex = indexOf("acq_time");
  if (latIndex < 0 || lngIndex < 0 || dateIndex < 0 || timeIndex < 0) {
    throw new Error("NASA FIRMS CSV is missing required columns");
  }

  const rows: ParsedRow[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const cells = lines[index].split(",");
    if (cells.length < header.length) continue;

    const lat = Number(cells[latIndex]);
    const lng = Number(cells[lngIndex]);
    const frpMw = frpIndex >= 0 ? Number(cells[frpIndex]) : 0;
    const confidencePct = confidenceIndex >= 0 ? parseConfidence(cells[confidenceIndex]) : 65;
    const detectedAt = toTimestamp(cells[dateIndex].trim(), cells[timeIndex]);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(frpMw)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    if (confidencePct < 50 || frpMw <= 0 || !detectedAt) continue;
    rows.push({ lat, lng, frpMw, confidencePct, detectedAt });
  }

  return { sourceRows: lines.length - 1, rows };
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function toPoint(row: ParsedRow): CachedFirmsPoint {
  const fingerprint = `${row.detectedAt}|${row.lat.toFixed(4)}|${row.lng.toFixed(4)}`;
  return {
    id: `firms-${hash(fingerprint).toString(36)}`,
    lat: Math.round(row.lat * 10_000) / 10_000,
    lng: Math.round(row.lng * 10_000) / 10_000,
    frpMw: Math.round(row.frpMw * 10) / 10,
    confidencePct: Math.round(row.confidencePct),
    detectedAt: row.detectedAt,
  };
}

function comparePoints(a: CachedFirmsPoint, b: CachedFirmsPoint): number {
  return b.frpMw - a.frpMw
    || b.confidencePct - a.confidencePct
    || b.detectedAt.localeCompare(a.detectedAt)
    || a.id.localeCompare(b.id);
}

function gridCellKey(point: CachedFirmsPoint): string {
  const latCell = Math.floor((point.lat + 90) / GRID_CELL_DEGREES);
  const lngCell = Math.floor((point.lng + 180) / GRID_CELL_DEGREES);
  return `${latCell}:${lngCell}`;
}

export function selectPoints(rows: ParsedRow[]): CachedFirmsPoint[] {
  const unique = new Map<string, CachedFirmsPoint>();
  for (const row of rows) {
    const point = toPoint(row);
    const existing = unique.get(point.id);
    if (!existing || comparePoints(point, existing) < 0) unique.set(point.id, point);
  }
  const sorted = [...unique.values()].sort(comparePoints);
  if (sorted.length <= MAX_POINTS) return sorted;

  // Preserve the absolute largest threats first, independent of density.
  // Then fill the remaining capacity in rounds across 2-degree cells so a
  // dense region cannot crowd entire countries out of the global dataset.
  const selected = sorted.slice(0, PRIORITY_POINTS);
  const buckets = new Map<string, CachedFirmsPoint[]>();
  for (const point of sorted.slice(PRIORITY_POINTS)) {
    const key = gridCellKey(point);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(point);
    else buckets.set(key, [point]);
  }

  const orderedBuckets = [...buckets.entries()].sort(([keyA, pointsA], [keyB, pointsB]) => (
    comparePoints(pointsA[0], pointsB[0]) || keyA.localeCompare(keyB)
  ));
  for (let round = 0; selected.length < MAX_POINTS; round += 1) {
    let addedThisRound = 0;
    for (const [, bucket] of orderedBuckets) {
      const point = bucket[round];
      if (!point) continue;
      selected.push(point);
      addedThisRound += 1;
      if (selected.length === MAX_POINTS) break;
    }
    if (addedThisRound === 0) break;
  }

  return selected;
}

export async function refreshFirmsCache(env: FirmsIngestEnv): Promise<FirmsCachePayload> {
  if (!env.FIRMS_MAP_KEY?.trim()) throw new Error("FIRMS_MAP_KEY is not configured");
  const response = await fetch(
    buildFirmsWorldUrl(env.FIRMS_MAP_KEY),
    { cache: "no-store", headers: { Accept: "text/csv" } },
  );
  if (!response.ok) throw new Error(`NASA FIRMS request failed: ${response.status}`);

  const parsed = parseCsv(await response.text());
  const points = selectPoints(parsed.rows);
  const payload: FirmsCachePayload = {
    version: 1,
    source: "NASA FIRMS VIIRS_SNPP_NRT",
    generatedAt: new Date().toISOString(),
    sourceRows: parsed.sourceRows,
    filteredRows: parsed.rows.length,
    points,
  };
  if (!isGlobalFirmsCachePayload(payload)) {
    throw new Error(`NASA FIRMS returned an incomplete worldwide feed (${points.length} points)`);
  }

  // Deliberately omit a KV TTL. A failed NASA refresh must not erase the
  // last known-good worldwide snapshot; freshness is communicated separately.
  await env.FIRMS_CACHE.put(FIRMS_CACHE_KEY, JSON.stringify(payload));
  console.log("FIRMS cache refreshed", {
    generatedAt: payload.generatedAt,
    sourceRows: payload.sourceRows,
    filteredRows: payload.filteredRows,
    cachedPoints: payload.points.length,
  });
  return payload;
}
