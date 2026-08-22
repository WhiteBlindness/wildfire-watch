import type { WildfireEvent } from "./types";

/**
 * Raw input to the thermal-density weighting model. Deliberately RAW
 * detection coordinates — never grid-snapped. Feeding grid-snapped cell
 * centres (as `viirs.ts` does for the pixel-mosaic representation) into a
 * MapLibre `heatmap` layer produces a lattice-of-dots artifact instead of an
 * organic density field, because every point in a cell collapses onto the
 * same coordinate. This module's entire job is to avoid that trap.
 */
export interface DensityPoint {
  id: string;
  lat: number;
  lng: number;
  frpMw: number;
  confidencePct: number;
  detectedAt: string;
}

export interface DensityWeightOptions {
  /** Reference "now" for recency decay, ms since epoch. Defaults to Date.now(). */
  nowMs?: number;
  /** Exponential half-life for recency decay, in hours. Defaults to 24. */
  halfLifeHours?: number;
}

export interface DensityFeatureProperties {
  /** Final combined weight in (0, 1], fed to MapLibre's `heatmap-weight`. */
  weight: number;
  frpMw: number;
  confidencePct: number;
  detectedAt: string;
  /** Age of the detection relative to `nowMs`, in hours (>= 0; guarded). */
  ageHours: number;
}

/** MapLibre cannot represent latitudes beyond the Web Mercator limit. */
const MAX_MAPLIBRE_LATITUDE = 85.0511287798066;

/** Same latitude/longitude validity contract as viirs.ts's isValidCoordinate. */
function isValidCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= -MAX_MAPLIBRE_LATITUDE
    && lat <= MAX_MAPLIBRE_LATITUDE
    && lng >= -180
    && lng <= 180;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Weight model
//
// The exported `weight` is NOT a physical unit. It is a dimensionless (0, 1]
// visual-intensity score for the MapLibre `heatmap-weight` / `heatmap-density`
// pipeline, built from three independently-documented, independently-testable
// components multiplied together:
//
//   weight = clamp(frpComponent(frpMw) * recency(ageHours) * confidenceFactor(confidencePct), WEIGHT_FLOOR, 1)
//
// 1. frpComponent — FRP magnitude, log-compressed.
//    Measured VIIRS Fire Radiative Power is heavy-tailed: most detected pixels
//    sit under ~10 MW, while rare extreme pixels exceed 100+ MW. A linear map
//    (e.g. frpMw / 185) would let a handful of extreme pixels saturate the
//    ramp and make the vast majority of real fire activity invisible. Using
//    log1p compresses the tail so the density field reflects the FULL
//    distribution of fire intensity, not just its outliers.
//
//      frpComponent = clamp(log1p(frpMw) / log1p(FRP_REF_MW), 0, 1)
//
//    FRP_REF_MW = 50 is the "saturation reference": a sustained ~50 MW pixel
//    (a strong, well-established fire front) maps to frpComponent ≈ 1. Pixels
//    well above 50 MW still map to ≤ 1 (clamped) but the log curve means the
//    100→200 MW jump moves the component far less than the 1→10 MW jump did —
//    doubling FRP never doubles weight.
//
// 2. recency — exponential half-life decay.
//    A detection loses "freshness" on the map over time. We model this as
//    exponential decay with a configurable half-life (default 24 h): a
//    detection exactly one half-life old contributes half the recency weight
//    of a brand-new one, two half-lives old contributes a quarter, etc.
//
//      recency = clamp(0.5 ** (ageHours / halfLifeHours), 0, 1)
//
//    ageHours is derived from `detectedAt` vs `nowMs`. Invalid timestamps
//    (unparseable) or a negative age (clock skew / detectedAt in the future)
//    are guarded to ageHours = 0 (i.e. treated as "now", not zeroed out).
//
// 3. confidenceFactor — a gentle multiplier from VIIRS's CATEGORICAL
//    confidence. FIRMS confidencePct is not really a continuous percentage;
//    it is one of three nominal categories reported as 30 / 65 / 90 (low /
//    nominal / high). We snap the input to whichever of those three levels it
//    is numerically closest to and apply a mild, never-zero multiplier, so a
//    low-confidence detection still shows up, just dimmer:
//
//      30 (low)     -> 0.6
//      65 (nominal) -> 0.85
//      90 (high)    -> 1.0
//
// The three components are multiplied, then clamped to a floor so that even
// a faint-but-fresh detection still registers on the density field rather
// than vanishing entirely — heatmap layers read as "gaps in coverage" when a
// weight rounds to zero, which is misleading for a live thermal feed.
// ---------------------------------------------------------------------------

/** FRP (MW) at which the log-compressed FRP component saturates to ~1. */
export const FRP_REF_MW = 50;

/** Default exponential half-life for recency decay, in hours. */
export const DEFAULT_HALF_LIFE_HOURS = 24;

/** Minimum weight any valid detection can produce. */
export const WEIGHT_FLOOR = 0.05;

const CONFIDENCE_LEVELS: ReadonlyArray<{ level: number; factor: number }> = [
  { level: 30, factor: 0.6 },
  { level: 65, factor: 0.85 },
  { level: 90, factor: 1.0 },
];

function frpComponent(frpMw: number): number {
  const safeFrp = Number.isFinite(frpMw) ? Math.max(0, frpMw) : 0;
  return clamp(Math.log1p(safeFrp) / Math.log1p(FRP_REF_MW), 0, 1);
}

function recencyComponent(ageHours: number, halfLifeHours: number): number {
  const safeAge = Number.isFinite(ageHours) && ageHours > 0 ? ageHours : 0;
  const safeHalfLife = Number.isFinite(halfLifeHours) && halfLifeHours > 0
    ? halfLifeHours
    : DEFAULT_HALF_LIFE_HOURS;
  return clamp(0.5 ** (safeAge / safeHalfLife), 0, 1);
}

function confidenceFactor(confidencePct: number): number {
  const safeConfidence = Number.isFinite(confidencePct) ? clamp(confidencePct, 0, 100) : 0;
  let nearest = CONFIDENCE_LEVELS[0];
  let bestDistance = Math.abs(safeConfidence - nearest.level);
  for (const candidate of CONFIDENCE_LEVELS.slice(1)) {
    const distance = Math.abs(safeConfidence - candidate.level);
    if (distance < bestDistance) {
      nearest = candidate;
      bestDistance = distance;
    }
  }
  return nearest.factor;
}

/**
 * Compute the combined (0, 1] density weight for one detection. Exposed
 * separately from the FeatureCollection builder so callers/tests can assert
 * on each sub-component's contribution in isolation.
 */
export function computeDensityWeight(
  frpMw: number,
  confidencePct: number,
  ageHours: number,
  halfLifeHours: number = DEFAULT_HALF_LIFE_HOURS,
): number {
  const raw = frpComponent(frpMw) * recencyComponent(ageHours, halfLifeHours) * confidenceFactor(confidencePct);
  return clamp(raw, WEIGHT_FLOOR, 1);
}

/** Round a coordinate to at most 5 decimal places (~1.1 m precision). */
function roundCoord(value: number): number {
  return Math.round(value * 100_000) / 100_000;
}

/**
 * Converts raw thermal detections into a weighted point FeatureCollection
 * for a MapLibre `heatmap` layer. One feature per input point — no grid
 * dedup, no snapping. Pure and synchronous.
 */
export function pointsToThermalDensityGeoJSON(
  points: readonly DensityPoint[],
  options: DensityWeightOptions = {},
): GeoJSON.FeatureCollection<GeoJSON.Point, DensityFeatureProperties> {
  const nowMs = options.nowMs ?? Date.now();
  const halfLifeHours = options.halfLifeHours ?? DEFAULT_HALF_LIFE_HOURS;

  const features: Array<GeoJSON.Feature<GeoJSON.Point, DensityFeatureProperties>> = [];

  for (const p of points) {
    if (!isValidCoordinate(p.lat, p.lng)) continue;

    const parsedMs = Date.parse(p.detectedAt);
    const rawAgeHours = Number.isFinite(parsedMs) ? (nowMs - parsedMs) / 3_600_000 : NaN;
    const ageHours = Number.isFinite(rawAgeHours) && rawAgeHours > 0 ? rawAgeHours : 0;

    const weight = computeDensityWeight(p.frpMw, p.confidencePct, ageHours, halfLifeHours);

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [roundCoord(p.lng), roundCoord(p.lat)],
      },
      properties: {
        weight,
        frpMw: p.frpMw,
        confidencePct: p.confidencePct,
        detectedAt: p.detectedAt,
        ageHours,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/**
 * Adapts a WildfireEvent snapshot into DensityPoints, for the "always show
 * something when zoomed in" path where a full raw-detection feed may not be
 * available and the per-event summary must stand in for it.
 */
export function eventsToDensityPoints(events: readonly WildfireEvent[]): DensityPoint[] {
  return events.map((event) => ({
    id: event.id,
    lat: event.location.lat,
    lng: event.location.lng,
    frpMw: event.satelliteDetection?.frpMw ?? event.maxFrpMw ?? 0,
    confidencePct: event.satelliteDetection?.confidencePct ?? 0,
    detectedAt: event.satelliteDetection?.detectedAt ?? event.startedAt,
  }));
}
