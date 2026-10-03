import type { ThermalDetection } from "./types";

export interface OverviewMetrics {
  totalFrpMw: number;
  maxFrpMw: number;
  averageFrpMw: number;
  validIntensityCount: number;
  /** Detections the source itself rates as high confidence. */
  highConfidenceCount: number;
}

function isValidFrp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** FRP is validated at ingest; this guards against malformed values reaching the totals. */
function measuredFrp(detection: ThermalDetection): number | null {
  return isValidFrp(detection.frpMw) ? detection.frpMw : null;
}

/**
 * Calculates the values shown by the global/country overview. Every value is a
 * measurement or a count of what the source reported, over the detections on
 * the map. The snapshot is a sample that keeps the strongest detections, so
 * these are not global totals, and no burned area is extrapolated from them.
 */
export function calculateOverviewMetrics(detections: ThermalDetection[]): OverviewMetrics | null {
  let totalFrpMw = 0;
  let maxFrpMw = Number.NEGATIVE_INFINITY;
  let validIntensityCount = 0;
  let highConfidenceCount = 0;

  for (const detection of detections) {
    if (detection.confidence === "high") highConfidenceCount += 1;
    const intensityMw = measuredFrp(detection);
    if (intensityMw === null) continue;
    totalFrpMw += intensityMw;
    maxFrpMw = Math.max(maxFrpMw, intensityMw);
    validIntensityCount += 1;
  }

  if (validIntensityCount === 0) return null;

  return {
    totalFrpMw,
    maxFrpMw,
    averageFrpMw: totalFrpMw / validIntensityCount,
    validIntensityCount,
    highConfidenceCount,
  };
}

/**
 * The most intense detections in the current scope, strongest first. This is
 * the panel's keyboard and screen-reader route into individual detections.
 */
export function selectStrongestDetections(detections: ThermalDetection[], limit: number): ThermalDetection[] {
  if (limit <= 0) return [];
  return detections
    .filter((detection) => measuredFrp(detection) !== null)
    .sort((a, b) => b.frpMw - a.frpMw)
    .slice(0, limit);
}
