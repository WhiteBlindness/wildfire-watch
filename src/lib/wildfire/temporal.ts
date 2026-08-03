import type { WildfireEvent } from "./types";

export const GLOBAL_TIMELINE_HOURS = 72;
/** Slider position used for the initial global snapshot: 100% / NOW. */
export const GLOBAL_TIMELINE_NOW = GLOBAL_TIMELINE_HOURS;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function detectionTime(event: WildfireEvent): number | null {
  const detectedAt = event.satelliteDetection?.detectedAt ?? event.lastUpdated;
  const parsed = Date.parse(detectedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function latestDetectionTime(events: WildfireEvent[]): number | null {
  let latest: number | null = null;
  for (const event of events) {
    const timestamp = detectionTime(event);
    if (timestamp !== null && (latest === null || timestamp > latest)) latest = timestamp;
  }
  return latest;
}

/**
 * Maps the 0-72 slider range onto the acquisition window. `null` means NOW,
 * where the complete validated snapshot is shown without an upper bound.
 */
export function timelineCutoffTimestamp(events: WildfireEvent[], timelineHour: number): number | null {
  const frameHour = clamp(timelineHour, 0, GLOBAL_TIMELINE_HOURS);
  if (frameHour === GLOBAL_TIMELINE_NOW) return null;
  const latest = latestDetectionTime(events);
  return latest === null ? null : latest - ((GLOBAL_TIMELINE_HOURS - frameHour) * 3_600_000);
}

/**
 * Filters the FIRMS snapshot by measured satellite acquisition time. Passing
 * the resulting collection to the clustered source forces MapLibre to rebuild
 * clusters and counts from only the detections visible at this frame.
 */
export function eventsToTemporalMarkerGeoJSON(
  events: WildfireEvent[],
  timelineHour: number,
): GeoJSON.FeatureCollection {
  const cutoffTimestamp = timelineCutoffTimestamp(events, timelineHour);

  return {
    type: "FeatureCollection",
    features: events.flatMap<GeoJSON.Feature>((event) => {
      const timestamp = detectionTime(event);
      if (timestamp === null || (cutoffTimestamp !== null && timestamp > cutoffTimestamp)) return [];

      const frpMw = event.satelliteDetection?.frpMw ?? event.maxFrpMw ?? 0;
      return [{
        type: "Feature",
        geometry: { type: "Point", coordinates: [event.location.lng, event.location.lat] },
        properties: {
          fireId: event.id,
          severity: event.severity,
          name: event.name,
          frpMw,
          temporalFrpMw: Math.max(0.1, frpMw),
          temporalRadiusScale: 1,
          temporalOpacity: 1,
          timestamp,
          confidencePct: event.satelliteDetection?.confidencePct ?? 0,
          detectedAt: event.satelliteDetection?.detectedAt ?? event.lastUpdated,
        },
      }];
    }),
  };
}
