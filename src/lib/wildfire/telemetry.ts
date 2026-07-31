import type { FireSeverity, FireTelemetry } from "./types";
import { mulberry32, seededRange } from "./random";

const HISTORY_HOURS: Record<FireSeverity, number> = {
  low: 24,
  moderate: 36,
  high: 48,
  extreme: 72,
};

const SEVERITY_SCALE: Record<FireSeverity, number> = {
  low: 0.7,
  moderate: 1,
  high: 1.55,
  extreme: 2.3,
};

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Creates a stable, illustrative incident timeline for the dashboard. FIRMS
 * measures a single thermal anomaly, not area or resource deployment, so the
 * result is always flagged as simulated for the UI.
 */
export function createSimulatedTelemetry(
  seed: string,
  observedAt: string,
  frpMw: number,
  severity: FireSeverity,
): FireTelemetry {
  const rand = mulberry32(hashSeed(seed));
  const samples = 13;
  const historyHours = HISTORY_HOURS[severity];
  const scale = SEVERITY_SCALE[severity];
  const observedMs = new Date(observedAt).getTime();
  const peakArea = Math.max(18, Math.round(frpMw * scale * seededRange(rand, 2.2, 5.4)));
  const peakGroundUnits = Math.max(12, Math.round(Math.sqrt(peakArea) * 7 * scale));
  const peakAerialUnits = Math.max(1, Math.round(scale * seededRange(rand, 1.5, 4)));

  return {
    simulated: true,
    points: Array.from({ length: samples }, (_, index) => {
      const progress = index / (samples - 1);
      const growth = 1 / (1 + Math.exp(-8 * (progress - 0.48)));
      const noise = seededRange(rand, 0.92, 1.08);
      return {
        timestamp: new Date(observedMs - (historyHours * (1 - progress) * 3_600_000)).toISOString(),
        areaBurned: Math.max(1, Math.round(peakArea * growth * noise)),
        groundUnits: Math.max(1, Math.round(peakGroundUnits * Math.min(1, growth * 1.16) * noise)),
        aerialUnits: Math.max(0, Math.round(peakAerialUnits * Math.min(1, growth * 1.3) * seededRange(rand, 0.8, 1.15))),
        frpTrend: Math.round(Math.max(0.2, frpMw * (0.42 + growth * 0.68) * seededRange(rand, 0.88, 1.12)) * 10) / 10,
      };
    }),
  };
}
