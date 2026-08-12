import {
  FIRMS_CACHE_KEY,
  isGlobalFirmsCachePayload,
  type CachedFirmsPoint,
  type FirmsCachePayload,
} from "../src/lib/wildfire/firms-cache";
import {
  parseCsv as parseCsvShared,
  toPoint as toPointShared,
  toTimestamp as toTimestampShared,
  type ParsedRow as ParsedRowShared,
} from "../src/lib/wildfire/firms-csv";

const FIRMS_BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const FIRMS_SOURCE = "VIIRS_SNPP_NRT";
const FIRMS_DAY_RANGE = 3;
const FIRMS_AREA = "world";
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

// Re-export for backwards compatibility with firms-ingest.test.ts.
export type ParsedRow = ParsedRowShared;
export { parseCsvShared as parseCsv, toTimestampShared as toTimestamp };

/**
 * Omit FIRMS' optional DATE segment. The API then selects the most recent
 * available NRT snapshot; deriving "today" in local time can request a
 * future GMT date around midnight. `world` is deliberately unrestricted.
 */
export function buildFirmsWorldUrl(mapKey: string): string {
  return `${FIRMS_BASE_URL}/${encodeURIComponent(mapKey.trim())}/${FIRMS_SOURCE}/${FIRMS_AREA}/${FIRMS_DAY_RANGE}`;
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
    const point = toPointShared(row);
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

  const parsed = parseCsvShared(await response.text());
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
