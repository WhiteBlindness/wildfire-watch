import type { FireSelection, GeoPoint, WildfireEvent } from "./types";

function validTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function eventToSelection(event: WildfireEvent): FireSelection {
  const detection = event.satelliteDetection;
  return {
    kind: "point",
    id: event.id,
    name: event.name,
    location: event.location,
    country: event.country,
    region: event.region,
    eventIds: [event.id],
    detectionCount: 1,
    totalFrpMw: detection?.frpMw ?? event.maxFrpMw ?? 0,
    confidencePct: detection?.confidencePct ?? null,
    startedAt: event.startedAt,
    detectedAt: detection?.detectedAt ?? event.lastUpdated,
  };
}

export function eventsToClusterSelection(
  events: WildfireEvent[],
  clusterId: number,
  location: GeoPoint,
): FireSelection | null {
  if (events.length === 0) return null;

  const sortedByStart = [...events].sort((a, b) => validTime(a.startedAt) - validTime(b.startedAt));
  const sortedByDetection = [...events].sort((a, b) => (
    validTime(b.satelliteDetection?.detectedAt ?? b.lastUpdated)
      - validTime(a.satelliteDetection?.detectedAt ?? a.lastUpdated)
  ));
  const countries = [...new Set(events.map((event) => event.country))];
  const regions = [...new Set(events.map((event) => event.region))];

  return {
    kind: "cluster",
    id: `cluster-${clusterId}`,
    name: "Major fire event",
    location,
    country: countries.length === 1 ? countries[0] : events[0].country,
    region: regions.length === 1 ? regions[0] : events[0].region,
    eventIds: events.map((event) => event.id),
    detectionCount: events.length,
    totalFrpMw: events.reduce(
      (sum, event) => sum + (event.satelliteDetection?.frpMw ?? event.maxFrpMw ?? 0),
      0,
    ),
    confidencePct: null,
    startedAt: sortedByStart[0].startedAt,
    detectedAt: sortedByDetection[0].satelliteDetection?.detectedAt ?? sortedByDetection[0].lastUpdated,
  };
}
