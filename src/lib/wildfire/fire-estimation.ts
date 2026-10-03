/**
 * A deliberately rough, bounded burned-area estimate for a selection of
 * satellite detections. It is shown with an "Estimate" label and a method note
 * and is never presented as an observed burn scar or a reported area.
 *
 * Method: radiative energy is approximated as the selection's measured FRP held
 * constant since its first detection, then converted to area.
 *   - 0.368 kg of dry biomass burns per MJ of radiative energy (Wooster et al.,
 *     2005, J. Geophys. Res. 110, D24311).
 *   - About 3.8 kg/m² of fuel is consumed, typical of shrubland and forest
 *     understorey; grass fires consume far less per square metre.
 *   - 1 MW·h = 3 600 MJ ≈ 1 325 kg ≈ 350 m² ≈ 0.035 ha.
 * FRP is not constant, VIIRS sees each place only a few times a day, and fuel
 * load varies by an order of magnitude, so the result is an order-of-magnitude
 * indication only. The bounds below keep it from implying precision.
 */
export const HECTARES_PER_MW_HOUR = 0.035;
const MIN_ELAPSED_HOURS = 0.5;
const MAX_ELAPSED_HOURS = 72;
const MIN_ESTIMATED_HECTARES = 0.1;
const MAX_ESTIMATED_HECTARES = 50_000;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function estimateBurnedAreaHectares(frpMw: number, firstAcquiredAt: string, nowMs = Date.now()): number {
  const firstMs = Date.parse(firstAcquiredAt);
  const rawElapsedHours = Number.isFinite(firstMs) ? (nowMs - firstMs) / 3_600_000 : MIN_ELAPSED_HOURS;
  const elapsedHours = clamp(rawElapsedHours, MIN_ELAPSED_HOURS, MAX_ELAPSED_HOURS);
  const safeFrpMw = Number.isFinite(frpMw) ? Math.max(0.1, frpMw) : 0.1;
  const estimate = clamp(safeFrpMw * elapsedHours * HECTARES_PER_MW_HOUR, MIN_ESTIMATED_HECTARES, MAX_ESTIMATED_HECTARES);

  return estimate < 10 ? Math.round(estimate * 10) / 10 : Math.round(estimate);
}
