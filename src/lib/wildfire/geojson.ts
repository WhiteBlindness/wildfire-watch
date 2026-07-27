import type { WildfireEvent } from "./types";

/** All heatmap hotspots across every fire, flattened into one FeatureCollection
 * for a single MapLibre heatmap layer (cheap to render at scale). */
export function eventsToHeatmapGeoJSON(events: WildfireEvent[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: events.flatMap((event) =>
      event.heatmapPoints.map<GeoJSON.Feature>((point) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [point.lng, point.lat] },
        properties: { intensity: point.intensity, fireId: event.id },
      })),
    ),
  };
}

/** Burned-area / fire-front perimeters as polygons, one feature per fire. */
export function eventsToPolygonGeoJSON(events: WildfireEvent[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: events
      .filter((event) => event.polygon && event.polygon.length > 2)
      .map<GeoJSON.Feature>((event) => ({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [event.polygon!.map((p) => [p.lng, p.lat])],
        },
        properties: { fireId: event.id, severity: event.severity, status: event.status },
      })),
  };
}

/** One point per fire (its origin/centroid) — the clickable marker layer. */
export function eventsToMarkerGeoJSON(events: WildfireEvent[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: events.map<GeoJSON.Feature>((event) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [event.location.lng, event.location.lat] },
      properties: {
        fireId: event.id,
        severity: event.severity,
        status: event.status,
        name: event.name,
      },
    })),
  };
}
