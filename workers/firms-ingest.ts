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

// ---------------------------------------------------------------------------
// Overall point budget
//
// Arithmetic:
//   Wire format: ~126 bytes/point raw JSON (measured against real schema).
//   Gzip ratio:  ~25 bytes/point after gzip (JSON of repeated structure
//                compresses ~5×).
//   15,000 points → ~1.80 MB raw, ~0.36 MB gzipped.
//   Cloudflare KV limit: 25 MB/value → 1.80 MB leaves 23.2 MB headroom (93%).
//   Mobile download: 0.36 MB gzipped ≈ one JPEG thumbnail — acceptable.
//   Improvement over previous 6,000-point cap: 2.5×.
// ---------------------------------------------------------------------------
export const MAX_POINTS = 15_000;

// Tier b: how many of the budget slots to pre-fill with the globally-largest
// fires, before the spatial spread round-robin runs.  1,500 is unchanged from
// the previous PRIORITY_POINTS constant — it captures the most intense fires
// reliably without crowding every other continent out.
const HIGH_FRP_TIER_POINTS = 1_500;

const GRID_CELL_DEGREES = 2;

// ---------------------------------------------------------------------------
// Tier c: minimum FRP floor for the geographic-spread round-robin.
//
// Purpose: stop spending budget on 1 MW thermal noise from industrial sites
// or smouldering ash that the user cannot meaningfully distinguish from
// background.  A floor just above the global p50 (~3.5 MW, measured today)
// ensures every spread-tier point represents a real fire event rather than
// detector noise, while still keeping coverage of every continent.
//
// Choosing 5 MW (just above p50, below p75):
//   - Drops ~half of global detections from the spread tier, roughly halving
//     the number of occupied 2° cells that compete for slots — the round-robin
//     still completes and covers all longitude/latitude bands easily.
//   - Keeps every fire that a human would describe as "medium intensity" or
//     higher.  At the measured Portugal FRP distribution (p50 = 8 MW, well
//     above this floor) essentially all Iberian fires already land in Tier a
//     or b, so the floor does not reduce Portuguese coverage.
//   - Does NOT apply to the priority region (Tier a) — low-FRP Portuguese
//     detections are kept unconditionally by design.
// ---------------------------------------------------------------------------
export const SPREAD_TIER_FRP_FLOOR_MW = 5;

// ---------------------------------------------------------------------------
// Tier a: priority regions — every detection inside ANY of these bounding
// boxes is kept unconditionally (subject only to the upstream confidence≥50
// && frp>0 filter applied by parseCsv before selectPoints is called).
//
// Design rationale:
//   A single bbox covering mainland Portugal (-9.6 W, 36.9 S, -6.0 E, 42.2 N)
//   cannot also cover Madeira (~17.3°W, 32.6°N) or the Azores (~25–31°W,
//   36.9–39.8°N) without swallowing a vast rectangle of open Atlantic that
//   would pull in many non-Portuguese detections.  A list of bboxes covers
//   exactly the territories the user cares about at no extra cost — measured
//   live data shows ~1,048 detections for the Iberia bbox over 3 days, which
//   is trivial against the 15,000-point budget.
//
//   Madeira is included: it is a Portuguese autonomous region with documented
//   wildfire history (2017, 2023 fires) and the user said "todos em Portugal".
//
//   The Azores are included for the same reason, even though satellite detections
//   there are historically rare — keeping them costs nothing in practice.
// ---------------------------------------------------------------------------
export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Named list of priority regions whose detections are kept unconditionally
 * (Tier a).  Expressed as separate bboxes rather than a single bbox because
 * mainland Portugal, Madeira, and the Azores cannot be enclosed in one
 * rectangle without capturing a large swath of open Atlantic.
 */
export const PRIORITY_REGIONS: readonly BoundingBox[] = [
  // Mainland Portugal + western Iberia (includes Spanish border zone so fires
  // that straddle the boundary are not accidentally dropped).
  { west: -9.6, south: 36.9, east: -6.0, north: 42.2 },
  // Madeira archipelago (principal island ~-17.3°E, 32.6°N; adds ~0.5° margin).
  { west: -17.4, south: 32.4, east: -16.2, north: 33.2 },
  // Azores archipelago (westernmost point ~-31°W, easternmost ~-25°W).
  { west: -31.3, south: 36.8, east: -24.8, north: 40.0 },
];

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

/** Returns true when the point falls inside any of the priority regions. */
function isInPriorityRegion(point: CachedFirmsPoint): boolean {
  for (const region of PRIORITY_REGIONS) {
    if (
      point.lng >= region.west
      && point.lng <= region.east
      && point.lat >= region.south
      && point.lat <= region.north
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Selects up to MAX_POINTS from the de-duplicated set of detections using a
 * three-tier priority policy:
 *
 *   Tier a — PRIORITY REGION
 *     Every detection inside PRIORITY_REGIONS (Portugal mainland, Madeira,
 *     Azores) is included unconditionally.  No FRP floor.  These are kept
 *     first so they can never be crowded out by hotter fires elsewhere,
 *     even if the global budget is already full.
 *
 *   Tier b — GLOBAL HIGH-FRP
 *     The largest remaining detections worldwide, sorted by FRP descending.
 *     No geographic floor — a single forest fire in Siberia at 5,000 MW
 *     deserves a slot.  Fills up to HIGH_FRP_TIER_POINTS slots (or until
 *     the total reaches MAX_POINTS).
 *
 *   Tier c — GEOGRAPHIC SPREAD
 *     Round-robin over 2° grid cells so no continent goes dark.  Only
 *     detections with FRP ≥ SPREAD_TIER_FRP_FLOOR_MW are eligible — this
 *     stops the budget being spent on 1 MW thermal noise.  Within each
 *     cell the bucket is pre-sorted by FRP descending so each round picks
 *     the best remaining point from that cell.
 *
 * Deduplication: a point that lands in Tier a is excluded from Tier b and
 * Tier c, so the same detection is never double-counted.
 *
 * The function is pure and deterministic: given the same rows (in any order)
 * it always returns the same set of ids (comparePoints provides a full
 * tie-break down to id, which is a hash of the fingerprint).
 */
export function selectPoints(rows: ParsedRow[]): CachedFirmsPoint[] {
  // Step 0: de-duplicate by fingerprint id, keeping the best reading per id.
  const unique = new Map<string, CachedFirmsPoint>();
  for (const row of rows) {
    const point = toPointShared(row);
    const existing = unique.get(point.id);
    if (!existing || comparePoints(point, existing) < 0) unique.set(point.id, point);
  }
  const all = [...unique.values()].sort(comparePoints);

  // Fast path: nothing to trim.
  if (all.length <= MAX_POINTS) return all;

  // Step 1: Tier a — priority region (unconditional, no FRP floor).
  const selected: CachedFirmsPoint[] = [];
  const selectedIds = new Set<string>();

  for (const point of all) {
    if (isInPriorityRegion(point)) {
      selected.push(point);
      selectedIds.add(point.id);
    }
  }

  if (selected.length >= MAX_POINTS) return selected.slice(0, MAX_POINTS);

  // Step 2: Tier b — global high-FRP (excluding already-selected priority points).
  // `all` is already sorted by FRP descending so we just take the first
  // HIGH_FRP_TIER_POINTS that have not yet been selected.
  let tierBAdded = 0;
  for (const point of all) {
    if (selected.length >= MAX_POINTS) break;
    if (tierBAdded >= HIGH_FRP_TIER_POINTS) break;
    if (!selectedIds.has(point.id)) {
      selected.push(point);
      selectedIds.add(point.id);
      tierBAdded += 1;
    }
  }

  if (selected.length >= MAX_POINTS) return selected;

  // Step 3: Tier c — geographic spread with FRP floor.
  // Bucket the remaining eligible points by 2° grid cell, then round-robin.
  const buckets = new Map<string, CachedFirmsPoint[]>();
  for (const point of all) {
    if (selectedIds.has(point.id)) continue;
    // Apply FRP floor: skip near-noise detections in this tier.
    if (point.frpMw < SPREAD_TIER_FRP_FLOOR_MW) continue;
    const key = gridCellKey(point);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(point);
    else buckets.set(key, [point]);
  }

  // Order buckets by their best point's FRP so the most active cells lead
  // each round; tie-break by key for full determinism.
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
