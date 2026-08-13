import { bbox, bboxPolygon, buffer, point } from "@turf/turf";
import type { CachedFirmsPoint } from "./firms-cache";
import type { HeatmapPoint, WildfireEvent } from "./types";

/** Native VIIRS 375 m nominal ground sampling distance at nadir. */
export const VIIRS_PIXEL_SIDE_METERS = 375;

/**
 * Half-side of the nominal nadir pixel in metres.  Used as the fallback buffer
 * radius when a detection's scan/track columns are absent or the CSV predates
 * the per-detection dimension fields.  Named here (not as a bare 187.5) so the
 * intent is explicit everywhere it appears.
 */
export const VIIRS_HALF_PIXEL_SIDE_METERS = VIIRS_PIXEL_SIDE_METERS / 2;
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

/**
 * Build a VIIRS pixel footprint for the given centre coordinate.
 *
 * The pipeline follows the original turf sequence — point → buffer → bbox →
 * bboxPolygon — generalised to support non-square footprints:
 *
 *   1. Buffer the centre by scanHalfM (E-W half-extent) to obtain east/west
 *      bounds, and separately by trackHalfM (N-S half-extent) for north/south.
 *   2. Combine the two bbox pairs into a single [west, south, east, north] bbox.
 *   3. Pass through bboxPolygon (and the antimeridian split when needed).
 *
 * When scanHalfM === trackHalfM === VIIRS_HALF_PIXEL_SIDE_METERS (the nominal
 * nadir case) both buffers produce the same circle, so the combined bbox is
 * exactly what the original single-buffer call produced — byte-identical output
 * on all existing nominal detections.
 *
 * The antimeridian normalisation and split are applied to the scan (E-W) buffer
 * — the same buffer from which the critical west/east edges are derived.
 *
 * @param coord       Cell-centre longitude/latitude.
 * @param scanHalfM   Half-extent in the along-scan (E-W) direction, metres.
 *                    Defaults to the nominal nadir 187.5 m.
 * @param trackHalfM  Half-extent in the along-track (N-S) direction, metres.
 *                    Defaults to the nominal nadir 187.5 m.
 */
function makePixelPolygon(
  coord: GeoCoordinate,
  scanHalfM: number = VIIRS_HALF_PIXEL_SIDE_METERS,
  trackHalfM: number = VIIRS_HALF_PIXEL_SIDE_METERS,
): PixelGeometry {
  const center = point([coord.lng, coord.lat]);

  // E-W extents come from the scan buffer; antimeridian handling is applied here.
  const scanBuffer = buffer(center, scanHalfM, { units: "meters" });
  if (!scanBuffer || scanBuffer.geometry.type !== "Polygon") {
    throw new Error(`Unable to construct VIIRS scan buffer at ${coord.lng}, ${coord.lat}`);
  }
  const scanPolygon = scanBuffer as GeoJSON.Feature<GeoJSON.Polygon>;
  const scanDirectBounds = bbox(scanPolygon);
  const crossesAntimeridian = scanDirectBounds[2] - scanDirectBounds[0] > 180;

  const normalizedScanPolygon: GeoJSON.Feature<GeoJSON.Polygon> = crossesAntimeridian
    ? {
        ...scanPolygon,
        geometry: {
          ...scanPolygon.geometry,
          coordinates: scanPolygon.geometry.coordinates.map((ring) => ring.map(([lng, lat]) => {
            const delta = lng - coord.lng;
            const longitude = delta > 180 ? lng - 360 : delta < -180 ? lng + 360 : lng;
            return [longitude, lat];
          })),
        },
      }
    : scanPolygon;
  const scanBounds = crossesAntimeridian ? bbox(normalizedScanPolygon) : scanDirectBounds;

  // N-S extents come from the track buffer.  The track buffer is always centred
  // far from the antimeridian in lat space, so no normalisation is needed —
  // we only need its south/north edges.
  const trackBuffer = buffer(center, trackHalfM, { units: "meters" });
  if (!trackBuffer || trackBuffer.geometry.type !== "Polygon") {
    throw new Error(`Unable to construct VIIRS track buffer at ${coord.lng}, ${coord.lat}`);
  }
  const trackBounds = bbox(trackBuffer as GeoJSON.Feature<GeoJSON.Polygon>);

  // Combine: use scan for E-W, track for N-S.
  const combinedBounds: GeoJSON.BBox = [scanBounds[0], trackBounds[1], scanBounds[2], trackBounds[3]];

  return crossesAntimeridian
    ? splitAntimeridianBounds(combinedBounds)
    : bboxPolygon(combinedBounds).geometry;
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
 * Model: one rectangle per 375 m ground cell, coloured by the PEAK fire
 * radiative power observed in that cell over the fetch window.  When multiple
 * raw detections (from different satellite overpasses) fall in the same 375 m
 * cell, they are collapsed into a single feature whose properties are:
 *   - frpMw        → maximum of all detection FRP values
 *   - confidencePct → maximum of all detection confidence values
 *   - detectedAt   → the most recent detection timestamp in the cell
 *   - fireId       → the id of the detection with the maximum FRP
 *   - scanHalfM    → half the along-scan (E-W) extent of the max-FRP detection
 *   - trackHalfM   → half the along-track (N-S) extent of the max-FRP detection
 *
 * Pixel dimensions (scan/track): when multiple detections collapse into one
 * cell we use the dimensions of the detection with the MAXIMUM FRP.  This is
 * the detection that sets the cell colour and is the most physically significant;
 * its footprint also determines how much area to draw.  Using max-FRP dims (not
 * max scan/track) keeps the drawn size tied to the dominant detection rather than
 * inflating it to an arbitrary worst-case swath edge.
 *
 * Snapping grid: always fixed at the nominal 375 m step regardless of per-
 * detection scan/track.  Variable-step grids do not tessellate — adjacent cells
 * would overlap or gap depending on which detection landed in each — which
 * breaks the "nunca se devem sobrepor" contract.  The fixed grid provides
 * stable, comparable dedup cells; only the drawn rectangle varies in size.
 *
 * The feature is emitted at the CELL CENTRE coordinate so adjacent cells share
 * an edge exactly when all detections are nominal.  Edge-of-swath detections
 * produce wider rectangles that physically overlap adjacent cells — this is
 * correct because the actual ground footprints overlap at swath edge.
 *
 * Points outside MapLibre's representable latitude range are silently dropped,
 * matching the behaviour of eventsToViirsPixelGeoJSON.
 */
export function pointsToViirsPixelGeoJSON(
  points: readonly CachedFirmsPoint[],
): GeoJSON.FeatureCollection<PixelGeometry, PixelProperties> {
  // Step 1: snap every valid detection onto the fixed 375 m ground grid and
  // accumulate per-cell aggregates.  The Map key is "rowIndex:colIndex".
  type CellAggregate = {
    cellCentLat: number;
    cellCentLng: number;
    fireId: string;
    frpMw: number;
    confidencePct: number;
    detectedAt: string;
    /** Half-extents for the drawn footprint, in metres. Set from the max-FRP detection. */
    scanHalfM: number;
    trackHalfM: number;
  };

  const cells = new Map<string, CellAggregate>();

  for (const p of points) {
    if (!isValidCoordinate(p)) continue;

    // Convert per-detection km dimensions to metres and halve.  Fall back to
    // the nominal nadir half-pixel when the column is absent.
    const scanHalfM = p.scanKm !== undefined
      ? (p.scanKm * 1_000) / 2
      : VIIRS_HALF_PIXEL_SIDE_METERS;
    const trackHalfM = p.trackKm !== undefined
      ? (p.trackKm * 1_000) / 2
      : VIIRS_HALF_PIXEL_SIDE_METERS;

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
        scanHalfM,
        trackHalfM,
      });
    } else {
      // Keep the most intense FRP, highest confidence, and latest timestamp.
      // Adopt the pixel dimensions of whichever detection has the maximum FRP
      // (the dominant detection determines the drawn footprint size).
      if (p.frpMw > existing.frpMw) {
        existing.frpMw = p.frpMw;
        existing.fireId = p.id;
        existing.scanHalfM = scanHalfM;
        existing.trackHalfM = trackHalfM;
      }
      if (p.confidencePct > existing.confidencePct) existing.confidencePct = p.confidencePct;
      if (p.detectedAt > existing.detectedAt) existing.detectedAt = p.detectedAt;
    }
  }

  // Step 2: emit one GeoJSON feature per cell, centred at the cell centre.
  // The geometry is built through the turf pipeline (point → buffer → bbox →
  // bboxPolygon, with antimeridian splitting), now generalised to per-detection
  // scan/track half-extents.  Snapping only changes WHICH centre coordinates
  // are used and the buffer radii — not the pipeline structure.
  const features = Array.from(cells.values()).map((cell): GeoJSON.Feature<PixelGeometry, PixelProperties> => ({
    type: "Feature",
    geometry: makePixelPolygon(
      { lng: cell.cellCentLng, lat: cell.cellCentLat },
      cell.scanHalfM,
      cell.trackHalfM,
    ),
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
