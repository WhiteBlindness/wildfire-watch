import type { WildfireEvent } from "./types";

export const GLOBAL_TIMELINE_HOURS = 72;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function stableOffset(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 13;
}

function detectionTime(event: WildfireEvent): number {
  const detectedAt = event.satelliteDetection?.detectedAt ?? event.lastUpdated;
  const parsed = Date.parse(detectedAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function inferredHistoryHours(event: WildfireEvent): number {
  const frpMw = event.satelliteDetection?.frpMw ?? event.maxFrpMw ?? 0;
  const severityHours = {
    low: 24,
    moderate: 36,
    high: 52,
    extreme: 64,
  }[event.severity];
  return clamp(severityHours + stableOffset(event.id) + Math.round(Math.log1p(frpMw) * 1.5), 18, GLOBAL_TIMELINE_HOURS);
}

/**
 * Produces a transparent, deterministic reconstruction for the global map.
 * FIRMS supplies snapshots rather than measured incident history, so the
 * slider deliberately scales FRP and presence using a seeded life-cycle.
 */
export function eventsToTemporalMarkerGeoJSON(
  events: WildfireEvent[],
  timelineHour: number,
): GeoJSON.FeatureCollection {
  const frameHour = clamp(timelineHour, 0, GLOBAL_TIMELINE_HOURS);
  const newestDetection = events.reduce((latest, event) => Math.max(latest, detectionTime(event)), 0) || Date.now();
  const frameMs = newestDetection - ((GLOBAL_TIMELINE_HOURS - frameHour) * 3_600_000);

  return {
    type: "FeatureCollection",
    features: events.flatMap<GeoJSON.Feature>((event) => {
      const observedAt = detectionTime(event);
      const historyMs = inferredHistoryHours(event) * 3_600_000;
      const progress = clamp((frameMs - (observedAt - historyMs)) / historyMs, 0, 1);
      if (progress < 0.025) return [];

      const growth = 1 - Math.exp(-3.2 * progress);
      const frpMw = event.satelliteDetection?.frpMw ?? event.maxFrpMw ?? 0;
      return [{
        type: "Feature",
        geometry: { type: "Point", coordinates: [event.location.lng, event.location.lat] },
        properties: {
          fireId: event.id,
          severity: event.severity,
          name: event.name,
          frpMw,
          temporalFrpMw: Math.max(0.1, frpMw * (0.12 + (growth * 0.88))),
          temporalRadiusScale: 0.38 + (growth * 0.62),
          temporalOpacity: 0.2 + (growth * 0.8),
          timelineProgress: progress,
          confidencePct: event.satelliteDetection?.confidencePct ?? 0,
          detectedAt: event.satelliteDetection?.detectedAt ?? event.lastUpdated,
        },
      }];
    }),
  };
}
