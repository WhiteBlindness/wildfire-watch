import { bbox, bboxPolygon, buffer, point } from "@turf/turf";
import type { CachedFirmsPoint } from "./firms-cache";
import type { HeatmapPoint, WildfireEvent } from "./types";

/** Native VIIRS 375 m nominal ground sampling distance. */
export const VIIRS_PIXEL_SIDE_METERS = 375;
const VIIRS_HALF_PIXEL_SIDE_METERS = VIIRS_PIXEL_SIDE_METERS / 2;
const MAX_MAPLIBRE_LATITUDE = 85.0511287798066;

// ---------------------------------------------------------------------------
// Ground-grid constants
//
// VIIRS pixels are 375 m × 375 m on the ground. Multiple satellite overpasses
// cover the same area with mutually offset swath grids, so naively placing one
// square per raw detection produces massively-overlapping, misaligned squares.
//
// The fix: snap every detection onto a fixed global 375 m ground grid and
// deduplicate into one cell per grid cell. Within a cell, we keep the maximum
// observed FRP (the most intense fire radiative power measurement dominates
// the burn-scar colour) plus the most recent detectedAt and the highest
// confidencePct. The rendered square is emitted at the CELL CENTRE — not at
// any raw detection coordinate — so adjacent cells share an edge exactly and
// the mosaic tessellates cleanly into the burn-scar pattern the NASA-FIRMS
// reference shows.
//
// This changes the semantics of pointsToViirsPixelGeoJSON from "one square
// per raw detection" to "one square per 375 m ground cell, coloured by the
// peak FRP observed in that cell over the fetch window". This is the correct
// model for a burn-scar mosaic.
// ---------------------------------------------------------------------------

/** Degrees of latitude spanned by one 375 m VIIRS pixel row. */
const VIIRS_LAT_STEP_DEG = VIIRS_PIXEL_SIDE_METERS / 111320;

/**
 * Degrees of longitude spanned by one 375 m VIIRS pixel column at the given
 * latitude. Uses the cosine of the cell-centre latitude so every column in
 * the same row shares an identical grid regardless of the raw detection
 * coordinates within the row.
 *
 * Guard: isValidCoordinate already limits |lat| ≤ 85.0511 where
 * cos(lat) ≥ 0.086, so there is no risk of division by zero. We keep an
 * explicit clamp as a belt-and-suspenders safety net.
 */
function viirslngStepDeg(latDeg: number): number {
  const cosLat = Math.cos((latDeg * Math.PI) / 180);
  return VIIRS_PIXEL_SIDE_METERS / (111320 * Math.max(cosLat, 1e-6));
}

/**
 * Snap a raw (lat, lng) detection coordinate onto the global 375 m VIIRS
 * ground grid and return the (rowIndex, colIndex, cellCentreLat,
 * cellCentreLng) for that cell.
 *
 * Grid origin is the equator/prime-meridian corner.  The column grid is
 * recomputed per-row (using the row-centre latitude) so every detection that
 * belongs to a given row uses the same lngStep — a necessary condition for
 * exact edge-to-edge tiling between adjacent columns.
 */
function snapToGrid(lat: number, lng: number): {
  rowIndex: number;
  colIndex: number;
  cellCentLat: number;
  cellCentLng: number;
} {
  const rowIndex = Math.round(lat / VIIRS_LAT_STEP_DEG);
  // Use the snapped row-centre latitude for the column step so every point in
  // the same row receives the same lngStep regardless of its raw latitude.
  const cellCentLat = rowIndex * VIIRS_LAT_STEP_DEG;
  const lngStep = viirslngStepDeg(cellCentLat);
  const colIndex = Math.round(lng / lngStep);
  const cellCentLng = colIndex * lngStep;
  return { rowIndex, colIndex, cellCentLat, cellCentLng };
}

type PixelProperties = {
  fireId: string;
  frp: number;
  frpMw: number;
  detectedAt: string;
  confidencePct: number;
};

type PixelGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

interface GeoCoordinate {
  lng: number;
  lat: number;
}

function isValidCoordinate(coord: GeoCoordinate): boolean {
  return Number.isFinite(coord.lng)
    && Number.isFinite(coord.lat)
    && coord.lng >= -180
    && coord.lng <= 180
    && coord.lat >= -MAX_MAPLIBRE_LATITUDE
    && coord.lat <= MAX_MAPLIBRE_LATITUDE;
}

function isValidHeatmapPoint(rawPoint: HeatmapPoint): boolean {
  return isValidCoordinate(rawPoint);
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

function makePixelPolygon(coord: GeoCoordinate): PixelGeometry {
  const center = point([coord.lng, coord.lat]);
  const pixelBuffer = buffer(center, VIIRS_HALF_PIXEL_SIDE_METERS, { units: "meters" });
  if (!pixelBuffer || pixelBuffer.geometry.type !== "Polygon") {
    throw new Error(`Unable to construct VIIRS pixel buffer at ${coord.lng}, ${coord.lat}`);
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
            const delta = lng - coord.lng;
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

/**
 * Converts full-resolution VIIRS point detections (from GET /api/fires/detail)
 * into native-sized VIIRS pixel footprints for burn-scar mosaic visualisation.
 *
 * Model: one square per 375 m ground cell, coloured by the PEAK fire radiative
 * power observed in that cell over the fetch window. When multiple raw
 * detections (from different satellite overpasses) fall in the same 375 m
 * cell, they are collapsed into a single square whose properties are:
 *   - frpMw      → maximum of all detection FRP values
 *   - confidencePct → maximum of all detection confidence values
 *   - detectedAt → the most recent detection timestamp in the cell
 *   - fireId     → the first detection's id (arbitrary within the cell)
 * The square is emitted at the CELL CENTRE coordinate so adjacent cells share
 * an edge exactly, producing a clean tessellated mosaic instead of
 * arbitrary-offset overlapping squares from misaligned overpass grids.
 *
 * Points outside MapLibre's representable latitude range are silently dropped,
 * matching the behaviour of eventsToViirsPixelGeoJSON.
 */
export function pointsToViirsPixelGeoJSON(
  points: readonly CachedFirmsPoint[],
): GeoJSON.FeatureCollection<PixelGeometry, PixelProperties> {
  // Step 1: snap every valid detection onto the 375 m ground grid and
  // accumulate per-cell aggregates.  The Map key is "rowIndex:colIndex".
  type CellAggregate = {
    cellCentLat: number;
    cellCentLng: number;
    fireId: string;
    frpMw: number;
    confidencePct: number;
    detectedAt: string;
  };

  const cells = new Map<string, CellAggregate>();

  for (const p of points) {
    if (!isValidCoordinate(p)) continue;

    const { rowIndex, colIndex, cellCentLat, cellCentLng } = snapToGrid(p.lat, p.lng);
    const key = `${rowIndex}:${colIndex}`;
    const existing = cells.get(key);

    if (!existing) {
      cells.set(key, {
        cellCentLat,
        cellCentLng,
        fireId: p.id,
        frpMw: p.frpMw,
        confidencePct: p.confidencePct,
        detectedAt: p.detectedAt,
      });
    } else {
      // Keep the most intense FRP, highest confidence, and latest timestamp.
      if (p.frpMw > existing.frpMw) existing.frpMw = p.frpMw;
      if (p.confidencePct > existing.confidencePct) existing.confidencePct = p.confidencePct;
      if (p.detectedAt > existing.detectedAt) existing.detectedAt = p.detectedAt;
    }
  }

  // Step 2: emit one GeoJSON feature per cell, centred at the cell centre.
  // The geometry is built through the existing, already-correct turf pipeline
  // (point → buffer(187.5 m) → bbox → bboxPolygon, with antimeridian splitting)
  // — snapping only changes WHICH centre coordinates are used, not the pipeline.
  const features = Array.from(cells.values()).map((cell): GeoJSON.Feature<PixelGeometry, PixelProperties> => ({
    type: "Feature",
    geometry: makePixelPolygon({ lng: cell.cellCentLng, lat: cell.cellCentLat }),
    properties: {
      fireId: cell.fireId,
      frp: cell.frpMw,
      frpMw: cell.frpMw,
      detectedAt: cell.detectedAt,
      confidencePct: cell.confidencePct,
    },
  }));

  return { type: "FeatureCollection", features };
}
