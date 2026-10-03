import type { ThermalDetection } from "./types";

export const GLOBAL_TIMELINE_HOURS = 72;
/** Slider position used for the initial global snapshot: 100% / NOW. */
export const GLOBAL_TIMELINE_NOW = GLOBAL_TIMELINE_HOURS;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function detectionTime(detection: ThermalDetection): number | null {
  const parsed = Date.parse(detection.acquiredAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function latestDetectionTime(detections: ThermalDetection[]): number | null {
  let latest: number | null = null;
  for (const detection of detections) {
    const timestamp = detectionTime(detection);
    if (timestamp !== null && (latest === null || timestamp > latest)) latest = timestamp;
  }
  return latest;
}

/**
 * Maps the 0-72 slider range onto the acquisition window. `null` means NOW,
 * where the complete validated snapshot is shown without an upper bound.
 */
export function timelineCutoffTimestamp(detections: ThermalDetection[], timelineHour: number): number | null {
  const frameHour = clamp(timelineHour, 0, GLOBAL_TIMELINE_HOURS);
  if (frameHour === GLOBAL_TIMELINE_NOW) return null;
  const latest = latestDetectionTime(detections);
  return latest === null ? null : latest - ((GLOBAL_TIMELINE_HOURS - frameHour) * 3_600_000);
}

/**
 * Filters the detections by measured satellite acquisition time. Passing
 * the resulting collection to the clustered source forces MapLibre to rebuild
 * clusters and counts from only the detections visible at this frame.
 */
export function detectionsToTemporalMarkerGeoJSON(
  detections: ThermalDetection[],
  timelineHour: number,
): GeoJSON.FeatureCollection {
  const cutoffTimestamp = timelineCutoffTimestamp(detections, timelineHour);

  return {
    type: "FeatureCollection",
    features: detections.flatMap<GeoJSON.Feature>((detection) => {
      const timestamp = detectionTime(detection);
      if (timestamp === null || (cutoffTimestamp !== null && timestamp > cutoffTimestamp)) return [];

      return [{
        type: "Feature",
        geometry: { type: "Point", coordinates: [detection.location.lng, detection.location.lat] },
        properties: {
          detectionId: detection.id,
          intensityBand: detection.intensityBand,
          frpMw: detection.frpMw,
          temporalFrpMw: Math.max(0.1, detection.frpMw),
          temporalRadiusScale: 1,
          temporalOpacity: 1,
          timestamp,
          acquiredAt: detection.acquiredAt,
        },
      }];
    }),
  };
}
