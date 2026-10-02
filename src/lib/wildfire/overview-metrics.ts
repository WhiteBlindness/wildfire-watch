import type { WildfireEvent } from "./types";

/** The deliberately simple projection used by the global overview. */
export const PROJECTED_BURN_AREA_HECTARES_PER_MW = 0.4;

export interface OverviewMetrics {
  totalFrpMw: number;
  maxFrpMw: number;
  averageFrpMw: number;
  projectedBurnAreaHectares: number;
  validIntensityCount: number;
}

function isValidFrp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Prefer the event's measured point value, falling back to a source-provided
 * peak value when the record does not carry an individual detection.
 */
export function resolveEventIntensityMw(event: WildfireEvent): number | null {
  if (isValidFrp(event.satelliteDetection?.frpMw)) return event.satelliteDetection.frpMw;
  if (isValidFrp(event.maxFrpMw)) return event.maxFrpMw;
  return null;
}

/**
 * Calculates the values shown by the global/country overview. The burned-area
 * value is explicitly a projection from total radiative power, not a measured
 * burn scar and not the time-based incident estimate used in fire details.
 */
export function calculateOverviewMetrics(events: WildfireEvent[]): OverviewMetrics | null {
  let totalFrpMw = 0;
  let maxFrpMw = Number.NEGATIVE_INFINITY;
  let validIntensityCount = 0;

  for (const event of events) {
    const intensityMw = resolveEventIntensityMw(event);
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
    projectedBurnAreaHectares: totalFrpMw * PROJECTED_BURN_AREA_HECTARES_PER_MW,
    validIntensityCount,
  };
}

/**
 * The most intense detections in the current scope, strongest first. This is
 * the panel's keyboard and screen-reader route into individual hotspots, so it
 * only lists events whose intensity is actually known.
 */
export function selectStrongestEvents(events: WildfireEvent[], limit: number): WildfireEvent[] {
  if (limit <= 0) return [];
  return events
    .map((event) => ({ event, intensity: resolveEventIntensityMw(event) }))
    .filter((entry): entry is { event: WildfireEvent; intensity: number } => entry.intensity !== null)
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, limit)
    .map((entry) => entry.event);
}
