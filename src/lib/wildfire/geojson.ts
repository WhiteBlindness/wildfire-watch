import type { WildfireEvent } from "./types";
import { estimateBurnedAreaHectares, estimatePerimeterRadiusKm } from "./fire-estimation";

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

const REFERENCE_PERIMETER_VERTICES = 18;

function referencePerimeter(event: WildfireEvent, radiusKm: number): GeoJSON.Position[] {
  const lngScale = 111 * Math.cos((event.location.lat * Math.PI) / 180);
  const ring = Array.from({ length: REFERENCE_PERIMETER_VERTICES }, (_, index) => {
    const angle = (index / REFERENCE_PERIMETER_VERTICES) * Math.PI * 2;
    const radialVariation = 0.86 + ((index * 7) % 5) * 0.035;
    return [
      event.location.lng + (Math.cos(angle) * radiusKm * radialVariation) / lngScale,
      event.location.lat + (Math.sin(angle) * radiusKm * radialVariation) / 111,
    ] as GeoJSON.Position;
  });
  return [...ring, ring[0]];
}

/** Show one perimeter only after a fire is selected. FIRMS points receive a
 * reference outline, never a claimed measured burn boundary. */
export function selectedEventToPolygonGeoJSON(
  events: WildfireEvent[],
  selectedId: string | null,
): GeoJSON.FeatureCollection {
  const event = selectedId ? events.find((item) => item.id === selectedId) : null;
  if (!event) return { type: "FeatureCollection", features: [] };

  const measuredPerimeter = event.polygon && event.polygon.length > 2;
  const frpMw = event.satelliteDetection?.frpMw ?? event.maxFrpMw ?? 0;
  const perimeterRadiusKm = estimatePerimeterRadiusKm(frpMw);
  const estimatedAreaHectares = event.satelliteDetection
    ? estimateBurnedAreaHectares(frpMw, event.startedAt)
    : event.areaHectares;
  const coordinates = measuredPerimeter
    ? event.polygon!.map((point) => [point.lng, point.lat] as GeoJSON.Position)
    : referencePerimeter(event, perimeterRadiusKm);

  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [coordinates] },
      properties: {
        fireId: event.id,
        severity: event.severity,
        status: event.status,
        perimeterKind: measuredPerimeter ? "reported" : "reference",
        frpMw,
        perimeterRadiusKm,
        estimatedAreaHectares,
      },
    }],
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
