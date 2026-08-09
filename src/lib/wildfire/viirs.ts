import { destination, point } from "@turf/turf";
import type { HeatmapPoint, WildfireEvent } from "./types";

/** Native VIIRS 375 m nominal ground sampling distance. */
export const VIIRS_PIXEL_SIDE_METERS = 375;
const VIIRS_HALF_PIXEL_SIDE_KILOMETERS = VIIRS_PIXEL_SIDE_METERS / 2 / 1_000;

type PixelProperties = {
  fireId: string;
  frp: number;
  frpMw: number;
  detectedAt: string;
  confidencePct: number;
};

function isValidHeatmapPoint(rawPoint: HeatmapPoint): boolean {
  return Number.isFinite(rawPoint.lng)
    && Number.isFinite(rawPoint.lat)
    && rawPoint.lng >= -180
    && rawPoint.lng <= 180
    && rawPoint.lat >= -90
    && rawPoint.lat <= 90;
}

function getFireFrpMw(event: WildfireEvent, rawPoint: HeatmapPoint): number {
  const measuredFrp = event.satelliteDetection?.frpMw ?? event.maxFrpMw;
  if (typeof measuredFrp === "number" && Number.isFinite(measuredFrp)) {
    return Math.max(0, measuredFrp);
  }

  // Mock/derived records may only carry normalized intensity. Keep a stable
  // visual fallback while real FIRMS records always use measured FRP above.
  const fallbackIntensity = Number.isFinite(rawPoint.intensity) ? rawPoint.intensity : 0;
  return Math.max(0, fallbackIntensity * 200);
}

function makePixelPolygon(rawPoint: HeatmapPoint): GeoJSON.Polygon {
  const center = point([rawPoint.lng, rawPoint.lat]);
  const north = destination(center, VIIRS_HALF_PIXEL_SIDE_KILOMETERS, 0, { units: "kilometers" });
  const east = destination(center, VIIRS_HALF_PIXEL_SIDE_KILOMETERS, 90, { units: "kilometers" });
  const south = destination(center, VIIRS_HALF_PIXEL_SIDE_KILOMETERS, 180, { units: "kilometers" });
  const west = destination(center, VIIRS_HALF_PIXEL_SIDE_KILOMETERS, 270, { units: "kilometers" });

  const [eastLng] = east.geometry.coordinates;
  const [, northLat] = north.geometry.coordinates;
  const [westLng] = west.geometry.coordinates;
  const [, southLat] = south.geometry.coordinates;

  return {
    type: "Polygon",
    coordinates: [[
      [westLng, southLat],
      [eastLng, southLat],
      [eastLng, northLat],
      [westLng, northLat],
      [westLng, southLat],
    ]],
  };
}

/**
 * Converts the selected incident's raw thermal detections into native-sized
 * VIIRS footprints. The source stays empty until a selection exists so the
 * global map keeps its lightweight clustered point presentation.
 */
export function eventsToViirsPixelGeoJSON(
  events: WildfireEvent[],
  selectedEventIds: readonly string[],
): GeoJSON.FeatureCollection<GeoJSON.Polygon, PixelProperties> {
  const selectedIds = new Set(selectedEventIds);
  if (selectedIds.size === 0) return { type: "FeatureCollection", features: [] };

  const features = events.flatMap<GeoJSON.Feature<GeoJSON.Polygon, PixelProperties>>((event) => {
    if (!selectedIds.has(event.id)) return [];

    return event.heatmapPoints
      .filter(isValidHeatmapPoint)
      .map((rawPoint) => {
        const frpMw = getFireFrpMw(event, rawPoint);
        return {
          type: "Feature",
          geometry: makePixelPolygon(rawPoint),
          properties: {
            fireId: event.id,
            frp: frpMw,
            frpMw,
            detectedAt: rawPoint.detectedAt,
            confidencePct: event.satelliteDetection?.confidencePct ?? 0,
          },
        };
      });
  });

  return { type: "FeatureCollection", features };
}
