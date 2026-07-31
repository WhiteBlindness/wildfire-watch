const HECTARES_PER_MW_HOUR = 0.035;
const MIN_ELAPSED_HOURS = 0.5;
const MAX_ELAPSED_HOURS = 72;
const MAX_ESTIMATED_HECTARES = 50_000;

const MIN_PERIMETER_RADIUS_KM = 0.45;
const MAX_PERIMETER_RADIUS_KM = 3.2;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * A bounded planning estimate derived from radiative power and time since the
 * first satellite detection. It is intentionally not presented as a measured
 * burn scar: weather, fuel and suppression activity are not available here.
 */
export function estimateBurnedAreaHectares(
  frpMw: number,
  startedAt: string,
  nowMs = Date.now(),
): number {
  const startedMs = Date.parse(startedAt);
  const rawElapsedHours = Number.isFinite(startedMs)
    ? (nowMs - startedMs) / 3_600_000
    : MIN_ELAPSED_HOURS;
  const elapsedHours = clamp(rawElapsedHours, MIN_ELAPSED_HOURS, MAX_ELAPSED_HOURS);
  const safeFrpMw = Math.max(0.1, frpMw);
  const estimate = clamp(
    safeFrpMw * elapsedHours * HECTARES_PER_MW_HOUR,
    0.1,
    MAX_ESTIMATED_HECTARES,
  );

  return estimate < 10
    ? Math.round(estimate * 10) / 10
    : Math.round(estimate);
}

/**
 * A square-root scale keeps low-power anomalies selectable while preserving a
 * strong, bounded visual difference between low- and high-FRP detections.
 */
export function estimatePerimeterRadiusKm(frpMw: number): number {
  const radiusKm = 0.32 + Math.sqrt(Math.max(0.1, frpMw)) * 0.11;
  return Math.round(clamp(radiusKm, MIN_PERIMETER_RADIUS_KM, MAX_PERIMETER_RADIUS_KM) * 100) / 100;
}
