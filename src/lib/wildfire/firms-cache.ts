import { lookupPlace } from "./geo-lookup";
import type { FireSeverity, WildfireEvent } from "./types";

export const FIRMS_CACHE_KEY = "active-fires:v1";

/**
 * Separate key for ingest health records. Must never equal FIRMS_CACHE_KEY so a
 * health-write can never overwrite a good snapshot. No TTL is set on either key
 * by design — the last known state survives worker restarts.
 */
export const FIRMS_INGEST_HEALTH_KEY = "active-fires:ingest-health:v1";

/**
 * Rolling recurrence history key. Stores how often each coarse grid cell has
 * produced detections across recent ingest runs, used by the persistent-source
 * suppression heuristic (Task 3).
 */
export const FIRMS_RECURRENCE_HISTORY_KEY = "active-fires:recurrence-history:v1";

/**
 * A worldwide VIIRS NRT response normally contains tens of thousands of
 * rows; the current ingest budget is 15,000 points.  This threshold
 * prevents a country-sized bbox request or a test fixture from replacing
 * the last known-good global snapshot in KV.
 *
 * Raised from 1,000 → 5,000 alongside the MAX_POINTS increase so the
 * guard scales with the expected output: a legitimate worldwide run always
 * produces the full budget (15,000), so 5,000 still comfortably rejects
 * any regional or fixture-sized payload while passing any real global one.
 * The longitude/latitude band checks below provide the geographic-spread
 * guard independently of this count threshold.
 */
export const FIRMS_MIN_GLOBAL_POINTS = 5_000;

export interface CachedFirmsPoint {
  id: string;
  lat: number;
  lng: number;
  frpMw: number;
  confidencePct: number;
  detectedAt: string;
  /**
   * Along-scan (roughly E-W) pixel dimension in km, as reported by the FIRMS
   * CSV `scan` column.  Absent on payloads written before this field was added
   * and on feeds that do not include the column.  When absent, consumers fall
   * back to the nominal VIIRS nadir resolution (0.375 km).
   */
  scanKm?: number;
  /**
   * Along-track (roughly N-S) pixel dimension in km, as reported by the FIRMS
   * CSV `track` column.  Same optionality contract as scanKm.
   */
  trackKm?: number;
}

export interface FirmsCachePayload {
  version: 1;
  source: "NASA FIRMS VIIRS_SNPP_NRT";
  generatedAt: string;
  sourceRows: number;
  filteredRows: number;
  points: CachedFirmsPoint[];
}

/**
 * Outcome of a single ingest attempt, stored under FIRMS_INGEST_HEALTH_KEY.
 * The FIRMS_MAP_KEY is never recorded here — error reasons are classified to
 * short codes to prevent the API key from leaking through the health endpoint.
 */
export interface IngestHealth {
  attemptedAt: string;
  outcome: "success" | "failure";
  /** Short error code, never the raw error message (which might contain the map key). */
  errorCode?: "network" | "http_error" | "incomplete_feed" | "parse_error" | "unknown";
  sourceRows?: number;
  filteredRows?: number;
  selectedPoints?: number;
  suppressedRows?: number;
}

/**
 * Per-cell recurrence record (kept compact to stay within the max-cell cap).
 */
export interface CellRecurrenceRecord {
  /** How many of the last N ingest runs saw detections in this cell. */
  recentHits: number;
  /** Total runs observed since the cell was first seen. */
  totalRuns: number;
  /** Timestamp of last detection, ISO string. */
  lastSeenAt: string;
}

/**
 * Full recurrence history stored in KV under FIRMS_RECURRENCE_HISTORY_KEY.
 * Max cell count is enforced during every write by evicting the least-recently-
 * seen cells if the map would exceed RECURRENCE_MAX_CELLS entries.
 */
export interface RecurrenceHistory {
  /**
   * Key format: `${latBucket},${lngBucket}` where buckets are 0.5° grid cells.
   * This matches RECURRENCE_CELL_DEGREES in firms-ingest.ts.
   */
  cells: Record<string, CellRecurrenceRecord>;
  /** How many ingest runs have contributed to this history. */
  totalRuns: number;
}

function severityFromFrp(frpMw: number): FireSeverity {
  if (frpMw >= 150) return "extreme";
  if (frpMw >= 50) return "high";
  if (frpMw >= 10) return "moderate";
  return "low";
}

export function cachedPointToEvent(point: CachedFirmsPoint, generatedAt: string): WildfireEvent {
  const severity = severityFromFrp(point.frpMw);
  const { country, region } = lookupPlace(point.lat, point.lng);

  return {
    id: point.id,
    name: "Satellite thermal anomaly",
    country,
    region,
    location: { lat: point.lat, lng: point.lng },
    status: "active",
    severity,
    startedAt: point.detectedAt,
    estimatedContainmentAt: null,
    containedAt: null,
    areaHectares: 0,
    polygon: null,
    heatmapPoints: [{
      lat: point.lat,
      lng: point.lng,
      intensity: Math.min(1, Math.max(0.15, point.frpMw / 200)),
      detectedAt: point.detectedAt,
    }],
    wind: null,
    forces: null,
    internationalAid: null,
    evolution: null,
    maxFrpMw: point.frpMw,
    satelliteDetection: {
      frpMw: point.frpMw,
      confidencePct: point.confidencePct,
      detectedAt: point.detectedAt,
    },
    source: "firms",
    lastUpdated: generatedAt,
  };
}

/**
 * Validate that a per-km dimension field is acceptable when present.
 * Returns true when the field is absent (undefined) OR when it is a finite
 * number within the documented VIIRS pixel range.  This deliberately mirrors
 * the clamp limits in firms-csv.ts so a freshly-written point can never fail
 * its own validation; old payloads without the field also pass unconditionally.
 */
function isValidOptionalDimKm(value: unknown): boolean {
  if (value === undefined) return true;
  // Import constants are not available here (circular-module risk), so inline
  // the same limits used in firms-csv.ts (0.3 km min, 2.0 km max).
  return typeof value === "number" && Number.isFinite(value) && value >= 0.3 && value <= 2.0;
}

export function isFirmsCachePayload(value: unknown): value is FirmsCachePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<FirmsCachePayload>;
  return payload.version === 1
    && payload.source === "NASA FIRMS VIIRS_SNPP_NRT"
    && typeof payload.generatedAt === "string"
    && Number.isInteger(payload.sourceRows)
    && Number.isInteger(payload.filteredRows)
    && Array.isArray(payload.points)
    && payload.points.every((point) => {
      if (!point || typeof point !== "object") return false;
      const candidate = point as Partial<CachedFirmsPoint>;
      const { lat, lng, frpMw, confidencePct } = candidate;
      return typeof candidate.id === "string"
        && typeof lat === "number"
        && Number.isFinite(lat)
        && lat >= -90
        && lat <= 90
        && typeof lng === "number"
        && Number.isFinite(lng)
        && lng >= -180
        && lng <= 180
        && typeof frpMw === "number"
        && Number.isFinite(frpMw)
        && frpMw > 0
        && typeof confidencePct === "number"
        && Number.isFinite(confidencePct)
        && confidencePct >= 0
        && confidencePct <= 100
        && typeof candidate.detectedAt === "string"
        && Number.isFinite(Date.parse(candidate.detectedAt))
        // scanKm and trackKm are OPTIONAL — absent on payloads written before
        // this field was introduced.  Validate only when present so old KV
        // snapshots continue to pass without a cron-forced refresh.
        && isValidOptionalDimKm(candidate.scanKm)
        && isValidOptionalDimKm(candidate.trackKm);
    });
}

/** Validate the invariants required before a payload is exposed as global data. */
export function isGlobalFirmsCachePayload(value: unknown): value is FirmsCachePayload {
  if (!isFirmsCachePayload(value)) return false;
  if (value.points.length < FIRMS_MIN_GLOBAL_POINTS) return false;

  const longitudeBands = new Set(value.points.map((point) => Math.floor((point.lng + 180) / 30)));
  const latitudeBands = new Set(value.points.map((point) => Math.floor((point.lat + 90) / 30)));
  return longitudeBands.size >= 8 && latitudeBands.size >= 4;
}
