import { bbox, bboxPolygon, buffer, point } from "@turf/turf";
import type { HeatmapPoint, WildfireEvent } from "./types";

/** Native VIIRS 375 m nominal ground sampling distance. */
export const VIIRS_PIXEL_SIDE_METERS = 375;
const VIIRS_HALF_PIXEL_SIDE_METERS = VIIRS_PIXEL_SIDE_METERS / 2;
const MAX_MAPLIBRE_LATITUDE = 85.0511287798066;

type PixelProperties = {
  fireId: string;
  frp: number;
  frpMw: number;
  detectedAt: string;
  confidencePct: number;
};

type PixelGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

function isValidHeatmapPoint(rawPoint: HeatmapPoint): boolean {
  return Number.isFinite(rawPoint.lng)
    && Number.isFinite(rawPoint.lat)
    && rawPoint.lng >= -180
    && rawPoint.lng <= 180
    && rawPoint.lat >= -MAX_MAPLIBRE_LATITUDE
    && rawPoint.lat <= MAX_MAPLIBRE_LATITUDE;
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

function splitAntimeridianBounds(bounds: GeoJSON.BBox): GeoJSON.MultiPolygon {
  const [west, south, east, north] = bounds;
  const parts = east > 180
    ? [
        bboxPolygon([west, south, 180, north]).geometry.coordinates,
        bboxPolygon([-180, south, east - 360, north]).geometry.coordinates,
      ]
    : [
        bboxPolygon([west + 360, south, 180, north]).geometry.coordinates,
        bboxPolygon([-180, south, east, north]).geometry.coordinates,
      ];

  return { type: "MultiPolygon", coordinates: parts };
}

function makePixelPolygon(rawPoint: HeatmapPoint): PixelGeometry {
  const center = point([rawPoint.lng, rawPoint.lat]);
  const pixelBuffer = buffer(center, VIIRS_HALF_PIXEL_SIDE_METERS, { units: "meters" });
  if (!pixelBuffer || pixelBuffer.geometry.type !== "Polygon") {
    throw new Error(`Unable to construct VIIRS pixel buffer at ${rawPoint.lng}, ${rawPoint.lat}`);
  }

  const polygonBuffer = pixelBuffer as GeoJSON.Feature<GeoJSON.Polygon>;
  const directBounds = bbox(polygonBuffer);
  const crossesAntimeridian = directBounds[2] - directBounds[0] > 180;
  const boundedBuffer: GeoJSON.Feature<GeoJSON.Polygon> = crossesAntimeridian
    ? {
        ...polygonBuffer,
        geometry: {
          ...polygonBuffer.geometry,
          coordinates: polygonBuffer.geometry.coordinates.map((ring) => ring.map(([lng, lat]) => {
            const delta = lng - rawPoint.lng;
            const longitude = delta > 180 ? lng - 360 : delta < -180 ? lng + 360 : lng;
            return [longitude, lat];
          })),
        },
      }
    : polygonBuffer;
  const pixelBounds = crossesAntimeridian ? bbox(boundedBuffer) : directBounds;
  return crossesAntimeridian
    ? splitAntimeridianBounds(pixelBounds)
    : bboxPolygon(pixelBounds).geometry;
}

/**
 * Converts the selected incident's raw thermal detections into native-sized
 * VIIRS footprints. The source stays empty until a selection exists so the
 * global map keeps its lightweight clustered point presentation.
 */
export function eventsToViirsPixelGeoJSON(
  events: WildfireEvent[],
  selectedEventIds: readonly string[],
): GeoJSON.FeatureCollection<PixelGeometry, PixelProperties> {
  const selectedIds = new Set(selectedEventIds);
  if (selectedIds.size === 0) return { type: "FeatureCollection", features: [] };

  const features = events.flatMap<GeoJSON.Feature<PixelGeometry, PixelProperties>>((event) => {
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
