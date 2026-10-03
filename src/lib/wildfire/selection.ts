import type { DetectionSelection, GeoPoint, ThermalDetection } from "./types";

function acquiredMs(detection: ThermalDetection): number {
  const parsed = Date.parse(detection.acquiredAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function detectionToSelection(detection: ThermalDetection): DetectionSelection {
  return {
    kind: "detection",
    id: detection.id,
    location: detection.location,
    country: detection.country,
    detectionIds: [detection.id],
    detectionCount: 1,
    totalFrpMw: detection.frpMw,
    confidence: detection.confidence,
    firstAcquiredAt: detection.acquiredAt,
    lastAcquiredAt: detection.acquiredAt,
    operationalStatus: "unknown",
  };
}

/**
 * A MapLibre cluster groups detections that are close on screen at the current
 * zoom. It is a display grouping, not an incident: the selection says how many
 * detections it holds and never claims an operational status.
 */
export function detectionsToClusterSelection(
  detections: ThermalDetection[],
  clusterId: number,
  location: GeoPoint,
): DetectionSelection | null {
  if (detections.length === 0) return null;

  const byTime = [...detections].sort((a, b) => acquiredMs(a) - acquiredMs(b));
  const countries = new Set(detections.map((detection) => detection.country));

  return {
    kind: "cluster",
    id: `cluster-${clusterId}`,
    location,
    country: countries.size === 1 ? detections[0].country : null,
    detectionIds: detections.map((detection) => detection.id),
    detectionCount: detections.length,
    totalFrpMw: detections.reduce((sum, detection) => sum + detection.frpMw, 0),
    confidence: null,
    firstAcquiredAt: byTime[0].acquiredAt,
    lastAcquiredAt: byTime[byTime.length - 1].acquiredAt,
    operationalStatus: "unknown",
  };
}
