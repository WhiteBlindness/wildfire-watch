import {
  area as turfArea,
  buffer,
  concave,
  convex,
  featureCollection,
  lineString,
  point,
} from "@turf/turf";
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

const MAX_CLUSTER_POINTS = 80;

function approximateDistanceKm(a: WildfireEvent, b: WildfireEvent): number {
  const meanLat = ((a.location.lat + b.location.lat) / 2) * (Math.PI / 180);
  const x = (a.location.lng - b.location.lng) * 111.32 * Math.cos(meanLat);
  const y = (a.location.lat - b.location.lat) * 111.32;
  return Math.hypot(x, y);
}

function buildDetectionPerimeter(
  event: WildfireEvent,
  events: WildfireEvent[],
  radiusKm: number,
): { geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; clusterSize: number; perimeterKind: string } {
  const clusterRadiusKm = Math.min(10, Math.max(3, radiusKm * 3));
  const nearby = events
    .map((candidate) => ({ candidate, distance: approximateDistanceKm(event, candidate) }))
    .filter(({ distance }) => distance <= clusterRadiusKm)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_CLUSTER_POINTS)
    .map(({ candidate }) => candidate);

  const points = featureCollection(nearby.map((candidate) => point([
    candidate.location.lng,
    candidate.location.lat,
  ])));
  const paddingKm = Math.min(0.9, Math.max(0.22, radiusKm * 0.28));

  try {
    if (nearby.length >= 3) {
      const hull = concave(points, { maxEdge: clusterRadiusKm * 0.9, units: "kilometers" })
        ?? convex(points);
      const organic = hull ? buffer(hull, paddingKm, { units: "kilometers", steps: 10 }) : null;
      if (organic) {
        return { geometry: organic.geometry, clusterSize: nearby.length, perimeterKind: "cluster-hull" };
      }
    }

    if (nearby.length === 2) {
      const corridor = buffer(lineString(nearby.map((candidate) => [
        candidate.location.lng,
        candidate.location.lat,
      ])), paddingKm, { units: "kilometers", steps: 10 });
      if (corridor) {
        return { geometry: corridor.geometry, clusterSize: 2, perimeterKind: "cluster-corridor" };
      }
    }
  } catch {
    // Malformed or degenerate groups fall back to a bounded isolated buffer.
  }

  const isolated = buffer(point([event.location.lng, event.location.lat]), radiusKm, {
    units: "kilometers",
    steps: 16,
  });
  if (!isolated) throw new Error("Unable to generate FIRMS perimeter");
  return { geometry: isolated.geometry, clusterSize: 1, perimeterKind: "isolated-buffer" };
}

/** Show one derived perimeter after selection: a nearby-detection hull or an
 * isolated estimated buffer, never a claimed measured burn boundary. */
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
  const generated = measuredPerimeter
    ? null
    : buildDetectionPerimeter(event, events, perimeterRadiusKm);
  const geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon = measuredPerimeter
    ? {
        type: "Polygon",
        coordinates: [event.polygon!.map((polygonPoint) => [polygonPoint.lng, polygonPoint.lat])],
      }
    : generated!.geometry;

  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry,
      properties: {
        fireId: event.id,
        severity: event.severity,
        status: event.status,
        perimeterKind: measuredPerimeter ? "reported" : generated!.perimeterKind,
        clusterSize: measuredPerimeter ? event.heatmapPoints.length : generated!.clusterSize,
        polygonAreaHectares: Math.round(turfArea({ type: "Feature", geometry, properties: {} }) / 10_000),
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
        name: event.name,
        frpMw: event.satelliteDetection?.frpMw ?? event.maxFrpMw ?? 0,
        confidencePct: event.satelliteDetection?.confidencePct ?? 0,
        detectedAt: event.satelliteDetection?.detectedAt ?? event.lastUpdated,
      },
    })),
  };
}
