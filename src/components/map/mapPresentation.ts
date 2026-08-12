export type MapTheme = "dark" | "light";
export type BasemapMode = "satellite" | "plain";

export const VECTOR_STYLE_URL = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;

// Satellite mode always uses dark-matter labels regardless of theme: white
// labels and boundary lines over imagery match Google Earth's convention and
// remain legible on both bright and shadowed terrain. The choice is visual,
// not a theme omission.
export const SATELLITE_STYLE_URL = VECTOR_STYLE_URL.dark;

// Void/space colour for the non-satellite (vector) basemap in globe projection.
// The light value keeps the atmosphere ring legible against a pale globe.
export const DARK_BACKGROUND = "#0f172a";
export const LIGHT_BACKGROUND = "#c9ddf0";

// Deep-ocean colour rendered below the satellite raster (visible in globe
// projection, tile seams, and very low zoom). Matched to Google Earth's
// abyssal trench colour — a rich indigo-navy, not near-black.
export const SATELLITE_BACKGROUND = "#0e3d62";

const MOBILE_GLOBAL_PANEL_HEIGHT_RATIO = 0.6;
const MOBILE_MAP_GAP = 24;

export interface CameraPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CameraPaddingOptions {
  viewportWidth: number;
  viewportHeight: number;
  panelOpen: boolean;
}

export interface StyleLayerLike {
  id: string;
  type: string;
  source?: unknown;
  "source-layer"?: string;
  filter?: unknown;
}

export interface SatelliteLayerPlan {
  overlayBeforeLayerId?: string;
}

interface StyleReadyObservable {
  isStyleLoaded(): boolean | void;
  on(event: "style.load", listener: () => void): void;
  off(event: "style.load", listener: () => void): void;
}

export function getMapStyleUrl(theme: MapTheme, basemapMode: BasemapMode): string {
  // Satellite mode is always dark-matter labels; see SATELLITE_STYLE_URL comment.
  return basemapMode === "satellite" ? SATELLITE_STYLE_URL : VECTOR_STYLE_URL[theme];
}

// Returns the void/space backdrop colour to apply to the MapLibre "background"
// layer in plain (vector) mode. In satellite mode the SATELLITE_BACKGROUND
// constant is used instead (it paints the ocean-bathymetry layer directly).
export function getBackdropColor(theme: MapTheme): string {
  return theme === "light" ? LIGHT_BACKGROUND : DARK_BACKGROUND;
}

// ---------------------------------------------------------------------------
// Water-layer override types
//
// The discriminated union encodes per-mode intent so callers cannot
// accidentally apply the wrong operation:
//
//   "hide"    — satellite mode: set layout visibility "none" so the CARTO fill
//               is invisible and the Esri World_Imagery bathymetric relief
//               (continental shelf, canyons, abyssal plains) shows through.
//               Verified live: hiding "water" + "water_shadow" at zoom 5 over
//               the Atlantic off Iberia reveals full blue bathymetric detail,
//               essentially identical to the Google Maps satellite reference.
//
//   "recolor" — plain (vector) mode: setPaintProperty fill-color with a
//               Google-Maps-style blue; water_shadow is transparent since it
//               was tuned for positron's pale canvas and looks wrong over blue.
//               Callers must also restore visibility:"visible" on satellite→plain
//               toggle so layers hidden in the previous satellite session show.
// ---------------------------------------------------------------------------

/** Instruct the caller to hide a water fill layer (satellite mode). */
export type WaterLayerHide = { id: string; action: "hide" };

/** Instruct the caller to paint a water fill layer in a specific colour (plain mode). */
export type WaterLayerRecolor = { id: string; action: "recolor"; color: string };

/** Discriminated union so the call site can branch on action rather than inferring intent from a colour. */
export type WaterLayerOverride = WaterLayerHide | WaterLayerRecolor;

// ---------------------------------------------------------------------------
// Keep the old name exported as an alias so internal tests compiled against
// the old type continue to work.  Callers that import WaterColorOverride by
// name will get the union type; ones that destructure { id, color } must be
// updated to branch on `action`.
// ---------------------------------------------------------------------------
/** @deprecated Use WaterLayerOverride instead. */
export type WaterColorOverride = WaterLayerOverride;

/**
 * Returns per-layer override instructions for the vector style's water layers.
 *
 * In SATELLITE mode: returns "hide" for every matched water fill layer so the
 * CARTO fill (#2C353C dark slate) is removed from view and the Esri
 * World_Imagery basemap's bathymetric relief (continental shelf, canyons,
 * abyssal plains) renders through. The Esri imagery carries genuine depth
 * colour — verified live over the Atlantic at zoom 5: hiding the CARTO fill
 * reveals rich blue ocean with clearly visible continental shelf and seamounts.
 *
 * In PLAIN (vector) mode: returns "recolor" for each matched water fill layer
 * so CARTO's near-white grey (positron) or muted blue-grey (dark-matter) is
 * replaced with a Google-Maps-style blue. water_shadow is painted transparent
 * because it was tuned for positron's pale canvas and looks wrong over blue.
 *
 * Matching strategy: target fill layers whose source-layer is "water" or whose
 * id contains "water". Both CARTO positron and dark-matter have "water" and
 * "water_shadow" layers that match this rule.
 *
 * The caller is responsible for applying each override via setLayoutProperty
 * (visibility) and/or setPaintProperty after the style has loaded.  Only
 * operate on EXISTING layers — adding new vector layers at style-load time is
 * unsafe because the source is not yet initialised, which silently breaks the
 * raster layer entirely.
 *
 * When switching FROM satellite TO plain, callers must also restore
 * visibility:"visible" (action:"recolor" implies the layer should be visible)
 * so previously-hidden layers are shown again.
 */
export function getWaterColorOverrides(
  layers: readonly StyleLayerLike[],
  theme: MapTheme,
  basemapMode: BasemapMode = "plain",
): WaterLayerOverride[] {
  const waterLayers = layers.filter(
    (layer) =>
      layer.type === "fill" &&
      (layer["source-layer"] === "water" || /water/i.test(layer.id)),
  );

  if (basemapMode === "satellite") {
    // Hide all CARTO water fill layers so the Esri bathymetric imagery shows.
    // The OCEAN_BATHYMETRY_LAYER background (SATELLITE_BACKGROUND colour)
    // remains as the below-tile fallback for missing tiles and very low zoom.
    return waterLayers.map((layer): WaterLayerHide => ({ id: layer.id, action: "hide" }));
  }

  // Plain (vector) mode: recolour to Google-Maps-style blue.
  const waterColor = theme === "light" ? "#a8d8f0" : "#1a3a52";
  return waterLayers.map((layer): WaterLayerRecolor => ({
    id: layer.id,
    action: "recolor",
    // water_shadow is a depth-effect layer tuned for pale positron backgrounds;
    // suppress it entirely when we take over the water colour.
    color: layer.id === "water_shadow" ? "transparent" : waterColor,
  }));
}

export function observeStyleReady(
  map: StyleReadyObservable,
  synchronize: () => void,
): () => void {
  const synchronizeOnStyleLoad = () => synchronize();

  map.on("style.load", synchronizeOnStyleLoad);
  if (map.isStyleLoaded() === true) synchronize();
  return () => map.off("style.load", synchronizeOnStyleLoad);
}

export function getCameraPadding({
  viewportWidth,
  viewportHeight,
  panelOpen,
}: CameraPaddingOptions): CameraPadding {
  const isDesktop = viewportWidth >= 768;
  return {
    top: 88,
    right: isDesktop ? 440 : 24,
    bottom: isDesktop
      ? 56
      : panelOpen
        ? Math.min(
            Math.round(viewportHeight * MOBILE_GLOBAL_PANEL_HEIGHT_RATIO) + MOBILE_MAP_GAP,
            Math.max(120, viewportHeight - 120),
          )
        : 88,
    left: isDesktop ? 40 : 24,
  };
}

// ---------------------------------------------------------------------------
// Detail-mosaic camera framing
// ---------------------------------------------------------------------------

export interface DetailCameraTarget {
  center: { lng: number; lat: number };
  zoom: number;
}

/**
 * Given a FeatureCollection of VIIRS pixel footprints (Polygon or MultiPolygon),
 * computes the map center and zoom level that frames the full mosaic while
 * respecting the given camera padding.
 *
 * The zoom is clamped so:
 *   - a lone detection stays at DETAIL_MOSAIC_MAX_ZOOM (never zoomed beyond the
 *     immediate flyTo target — avoids an abrupt second jump on a single pixel);
 *   - a very wide mosaic never zooms out below DETAIL_MOSAIC_MIN_ZOOM (keeps
 *     the mosaic legible rather than sub-pixel confetti).
 *
 * Antimeridian-crossing mosaics are handled by unwrapping longitudes before
 * computing bounds, then re-wrapping the centre into [-180, 180]. viirs.ts
 * splits antimeridian footprints into MultiPolygon, so both Polygon and
 * MultiPolygon geometries must be visited.
 *
 * Returns null when the collection is empty (caller keeps the existing camera).
 */
export function computeDetailCameraTarget(
  features: GeoJSON.FeatureCollection<GeoJSON.Geometry>,
  padding: CameraPadding,
  viewportWidth: number,
  viewportHeight: number,
): DetailCameraTarget | null {
  // Collect every ring vertex from Polygon and MultiPolygon geometries.
  const allCoords: [number, number][] = [];
  for (const feature of features.features) {
    const geom = feature.geometry;
    if (geom.type === "Polygon") {
      for (const ring of geom.coordinates) {
        for (const pos of ring) {
          allCoords.push([pos[0], pos[1]]);
        }
      }
    } else if (geom.type === "MultiPolygon") {
      for (const polygon of geom.coordinates) {
        for (const ring of polygon) {
          for (const pos of ring) {
            allCoords.push([pos[0], pos[1]]);
          }
        }
      }
    }
  }

  if (allCoords.length === 0) return null;

  const rawLngs = allCoords.map(([lng]) => lng);
  const rawLats = allCoords.map(([, lat]) => lat);
  const rawWest = Math.min(...rawLngs);
  const rawEast = Math.max(...rawLngs);

  // Detect an antimeridian straddle: viirs.ts splits crossing pixels into
  // MultiPolygon parts near ±180, so both sides are present in allCoords.
  // When the raw longitude span exceeds 180°, the data almost certainly
  // straddles the antimeridian rather than genuinely spanning a half-world.
  // In that case, shift every longitude < 0 by +360 to place all parts in
  // one contiguous arc on the east side, then unwrap from there. A secondary
  // check with a delta-based unwrap handles any residual outliers.
  const rawSpan = rawEast - rawWest;
  let unwrappedLngs: number[];
  if (rawSpan > 180) {
    // Antimeridian straddle: lift the west-side (negative) coordinates into
    // the [180, 360] range so the arc is contiguous.
    const liftedLngs = rawLngs.map((lng) => (lng < 0 ? lng + 360 : lng));
    const liftedCenter = (Math.min(...liftedLngs) + Math.max(...liftedLngs)) / 2;
    // Secondary delta unwrap in case any further outliers remain after lifting.
    unwrappedLngs = liftedLngs.map((lng) => {
      const delta = lng - liftedCenter;
      if (delta > 180) return lng - 360;
      if (delta < -180) return lng + 360;
      return lng;
    });
  } else {
    // Normal (non-antimeridian) case: use the raw centre as the unwrap anchor.
    const rawCenterLng = (rawWest + rawEast) / 2;
    unwrappedLngs = rawLngs.map((lng) => {
      const delta = lng - rawCenterLng;
      if (delta > 180) return lng - 360;
      if (delta < -180) return lng + 360;
      return lng;
    });
  }

  const west = Math.min(...unwrappedLngs);
  const east = Math.max(...unwrappedLngs);
  const south = Math.min(...rawLats);
  const north = Math.max(...rawLats);

  // Re-wrap the centre into [-180, 180] so flyTo receives a valid coordinate.
  let centerLng = (west + east) / 2;
  if (centerLng > 180) centerLng -= 360;
  if (centerLng < -180) centerLng += 360;
  const centerLat = (south + north) / 2;

  // Usable viewport dimensions after subtracting camera padding.
  // A minimum of 1 px prevents division by zero if padding exceeds the viewport.
  const usableWidth = Math.max(1, viewportWidth - padding.left - padding.right);
  const usableHeight = Math.max(1, viewportHeight - padding.top - padding.bottom);

  // Web-Mercator zoom formula: for each axis compute how many 256-px tiles would
  // be needed to span the feature extent, then pick the tighter constraint.
  //
  // latFraction: the proportion of the full Mercator-projected world height
  // covered by [south, north], expressed as a fraction of 2π.
  const latRad = (lat: number) => (lat * Math.PI) / 180;
  const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + latRad(lat) / 2));
  const latFraction = Math.max(
    (mercatorY(Math.min(north, 85.0511)) - mercatorY(Math.max(south, -85.0511))) / (2 * Math.PI),
    // A degenerate zero-height span (single row of pixels) gets a tiny epsilon
    // so the lat zoom doesn't blow up to Infinity before the clamp.
    1e-10,
  );
  const lngFraction = Math.max((east - west) / 360, 1e-10);

  const TILE_SIZE = 256;
  const zoomLat = Math.log2(usableHeight / TILE_SIZE / latFraction);
  const zoomLng = Math.log2(usableWidth / TILE_SIZE / lngFraction);
  const rawZoom = Math.min(zoomLat, zoomLng);

  // Clamp: a lone detection or tiny fire must not zoom beyond the immediate
  // flyTo target (DETAIL_MOSAIC_MAX_ZOOM = 12). A catastrophically wide mosaic
  // (approaching the route's 5° bbox cap) must not zoom below DETAIL_MOSAIC_MIN_ZOOM
  // (5) so the burn scar remains a recognisable shape rather than sub-pixel dots.
  const zoom = Math.min(
    Math.max(rawZoom, DETAIL_MOSAIC_MIN_ZOOM),
    DETAIL_MOSAIC_MAX_ZOOM,
  );

  return { center: { lng: centerLng, lat: centerLat }, zoom };
}

/** Maximum zoom when framing a full-resolution VIIRS mosaic. Matches
 *  FIRE_DETAIL_ZOOM in FireMap.tsx so a lone detection produces the same
 *  camera as the immediate flyTo and no jarring second movement occurs. */
export const DETAIL_MOSAIC_MAX_ZOOM = 12;

/** Minimum zoom when framing a full-resolution VIIRS mosaic. At zoom 5 a
 *  ~5° bbox (the API's hard cap) spans roughly the viewport width at desktop
 *  widths, so the mosaic is still readable rather than sub-pixel confetti. */
export const DETAIL_MOSAIC_MIN_ZOOM = 5;

export function getSatelliteLayerPlan(layers: readonly StyleLayerLike[]): SatelliteLayerPlan {
  // Preserve provider labels and administrative boundaries above imagery.
  // The bathymetry and water-tint layers are positioned relative to the raster
  // itself and must be excluded so they are not mistaken for label anchors.
  const overlayBeforeLayerId = layers.find((layer) => (
    layer.id !== "satellite-layer"
    && layer.id !== "ocean-bathymetry"
    && (layer.type === "symbol" || (layer.type === "line" && /boundary|admin/i.test(layer.id)))
  ))?.id;

  return { overlayBeforeLayerId };
}
