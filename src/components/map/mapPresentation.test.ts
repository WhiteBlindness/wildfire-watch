import assert from "node:assert/strict";
import test from "node:test";
import {
  getCameraPadding,
  getMapStyleUrl,
  getSatelliteLayerPlan,
  observeStyleReady,
  getBackdropColor,
  getWaterColorOverrides,
  computeDetailCameraTarget,
  SATELLITE_BACKGROUND,
  DARK_BACKGROUND,
  LIGHT_BACKGROUND,
  DETAIL_MOSAIC_MAX_ZOOM,
  DETAIL_MOSAIC_MIN_ZOOM,
  type WaterLayerOverride,
} from "./mapPresentation";
import {
  OCEAN_BATHYMETRY_LAYER,
  syncSatelliteLayers,
  type SatelliteLayerMap,
} from "./satelliteLayers";

test("uses the active light or dark vector style outside satellite mode", () => {
  assert.match(getMapStyleUrl("light", "plain"), /positron-gl-style/);
  assert.match(getMapStyleUrl("dark", "plain"), /dark-matter-gl-style/);
  assert.match(getMapStyleUrl("light", "satellite"), /dark-matter-gl-style/);
});

test("reserves the mobile sheet and desktop panel when fitting a country", () => {
  assert.deepEqual(
    getCameraPadding({ viewportWidth: 390, viewportHeight: 844, panelOpen: true }),
    { top: 88, right: 24, bottom: 530, left: 24 },
  );
  assert.deepEqual(
    getCameraPadding({ viewportWidth: 1440, viewportHeight: 900, panelOpen: true }),
    { top: 88, right: 440, bottom: 56, left: 40 },
  );
});

test("keeps compact padding when no mobile overlay is open", () => {
  assert.deepEqual(
    getCameraPadding({ viewportWidth: 390, viewportHeight: 844, panelOpen: false }),
    { top: 88, right: 24, bottom: 88, left: 24 },
  );
});

test("plans satellite imagery below the provider's label overlay", () => {
  const plan = getSatelliteLayerPlan([
    { id: "background", type: "background" },
    { id: "water", type: "fill", source: "carto", "source-layer": "water", filter: ["==", ["get", "class"], "ocean"] },
    { id: "country-label", type: "symbol", source: "carto", "source-layer": "place" },
  ]);

  assert.equal(plan.overlayBeforeLayerId, "country-label");
});

function createMapHarness() {
  const layers: Array<{ id: string; type: string; source?: string }> = [
    { id: "background", type: "background" },
    { id: "land", type: "fill", source: "carto" },
    { id: "country-label", type: "symbol", source: "carto" },
  ];
  const sources = new Set<string>();
  const additions: Array<{ layer: unknown; beforeId?: string }> = [];

  const map: SatelliteLayerMap = {
    getStyle: () => ({ layers }),
    getLayer: (id) => layers.find((layer) => layer.id === id),
    addLayer: (layer, beforeId) => {
      additions.push({ layer, beforeId });
      const insertionIndex = beforeId
        ? layers.findIndex((candidate) => candidate.id === beforeId)
        : layers.length;
      const nextLayer = layer as { id: string; type: string; source?: string };
      layers.splice(insertionIndex < 0 ? layers.length : insertionIndex, 0, nextLayer);
    },
    moveLayer: (id, beforeId) => {
      const currentIndex = layers.findIndex((layer) => layer.id === id);
      if (currentIndex < 0) return;
      const [layer] = layers.splice(currentIndex, 1);
      const insertionIndex = beforeId
        ? layers.findIndex((candidate) => candidate.id === beforeId)
        : layers.length;
      layers.splice(insertionIndex < 0 ? layers.length : insertionIndex, 0, layer);
    },
    removeLayer: (id) => {
      const index = layers.findIndex((layer) => layer.id === id);
      if (index >= 0) layers.splice(index, 1);
    },
    getSource: (id) => sources.has(id) ? {} : undefined,
    addSource: (id) => {
      sources.add(id);
    },
    removeSource: (id) => {
      sources.delete(id);
    },
  };

  return { map, layers, sources, additions };
}

test("inserts ocean bathymetry strictly below satellite raster and keeps labels above", () => {
  const harness = createMapHarness();

  syncSatelliteLayers(harness.map, "satellite");
  syncSatelliteLayers(harness.map, "satellite");

  const bathymetryAddition = harness.additions.find(({ layer }) => (
    (layer as { id?: string }).id === "ocean-bathymetry"
  ));
  assert.deepEqual(bathymetryAddition, {
    layer: {
      id: "ocean-bathymetry",
      type: "background",
      paint: { "background-color": SATELLITE_BACKGROUND },
    },
    beforeId: "satellite-layer",
  });
  assert.deepEqual(OCEAN_BATHYMETRY_LAYER, bathymetryAddition?.layer);
  assert.deepEqual(
    harness.layers.map(({ id }) => id),
    ["background", "land", "ocean-bathymetry", "satellite-layer", "country-label"],
  );
});

test("removes satellite raster, bathymetry, and source cleanly in plain mode", () => {
  const harness = createMapHarness();
  syncSatelliteLayers(harness.map, "satellite");

  syncSatelliteLayers(harness.map, "plain");

  assert.equal(harness.layers.some(({ id }) => id === "ocean-bathymetry"), false);
  assert.equal(harness.layers.some(({ id }) => id === "satellite-layer"), false);
  assert.equal(harness.sources.has("satellite-src"), false);
});

test("getBackdropColor returns theme-aware void colours", () => {
  assert.equal(getBackdropColor("dark"), DARK_BACKGROUND);
  assert.equal(getBackdropColor("light"), LIGHT_BACKGROUND);
  // Light backdrop must not be the same as the dark one.
  assert.notEqual(getBackdropColor("light"), getBackdropColor("dark"));
});

test("getWaterColorOverrides targets fill layers by source-layer or id", () => {
  const layers = [
    { id: "background", type: "background" },
    { id: "water", type: "fill", "source-layer": "water" },
    { id: "water_shadow", type: "fill", "source-layer": "water" },
    { id: "land", type: "fill", "source-layer": "landuse" },
    { id: "waterway", type: "line", "source-layer": "waterway" },
    { id: "country-label", type: "symbol", "source-layer": "place" },
  ];

  const lightOverrides = getWaterColorOverrides(layers, "light");
  // Only fill layers with source-layer "water" or /water/ in id qualify.
  // "waterway" is type "line" so it is excluded.
  assert.equal(lightOverrides.length, 2);
  const waterOverride = lightOverrides.find(({ id }) => id === "water") as WaterLayerOverride | undefined;
  assert.ok(waterOverride, "water layer should be overridden");
  // Plain mode → recolor action.
  assert.equal(waterOverride?.action, "recolor", "plain mode must produce recolor action");
  assert.ok(
    waterOverride?.action === "recolor" && waterOverride.color.startsWith("#"),
    "color should be a hex value",
  );
  const shadowOverride = lightOverrides.find(({ id }) => id === "water_shadow") as WaterLayerOverride | undefined;
  // water_shadow is suppressed since it was tuned for positron's pale canvas.
  assert.ok(
    shadowOverride?.action === "recolor" && shadowOverride.color === "transparent",
    "water_shadow must be suppressed (transparent) in plain mode",
  );

  const darkOverrides = getWaterColorOverrides(layers, "dark");
  assert.equal(darkOverrides.length, 2);
  const darkWater = darkOverrides.find(({ id }) => id === "water") as WaterLayerOverride | undefined;
  // Dark mode water should differ from light mode colour.
  assert.ok(darkWater?.action === "recolor" && waterOverride?.action === "recolor");
  assert.notEqual(darkWater?.color, waterOverride?.color);
});

test("getWaterColorOverrides returns empty array when no water layers exist", () => {
  const layers = [
    { id: "background", type: "background" },
    { id: "land", type: "fill", "source-layer": "landuse" },
  ];
  assert.deepEqual(getWaterColorOverrides(layers, "light"), []);
  assert.deepEqual(getWaterColorOverrides(layers, "dark"), []);
});

test("getWaterColorOverrides in satellite mode hides water layers to reveal Esri bathymetry", () => {
  // In satellite mode, hiding the CARTO water fill layers reveals the Esri
  // World_Imagery basemap's bathymetric detail (continental shelf, canyons,
  // abyssal plains) — verified live over the Atlantic at zoom 5. The CARTO
  // "water" fill (#2C353C dark slate) sits ABOVE the raster in the layer stack
  // and was covering the bathymetry; hiding it exposes the full depth colour.
  const layers = [
    { id: "background", type: "background" },
    { id: "waterway", type: "line", "source-layer": "waterway" },
    { id: "water", type: "fill", "source-layer": "water" },
    { id: "water_shadow", type: "fill", "source-layer": "water" },
    { id: "country-label", type: "symbol", "source-layer": "place" },
  ];

  const overrides = getWaterColorOverrides(layers, "dark", "satellite");
  assert.equal(overrides.length, 2, "only fill water layers are targeted");

  const waterOverride = overrides.find(({ id }) => id === "water");
  assert.ok(waterOverride, "water layer must be targeted in satellite mode");
  assert.equal(waterOverride?.action, "hide", "satellite mode must hide water layers");

  const shadowOverride = overrides.find(({ id }) => id === "water_shadow");
  assert.ok(shadowOverride, "water_shadow must be targeted in satellite mode");
  assert.equal(shadowOverride?.action, "hide", "water_shadow must also be hidden in satellite mode");

  // Satellite mode is theme-independent — light theme produces the same hide action.
  const lightOverrides = getWaterColorOverrides(layers, "light", "satellite");
  const lightWater = lightOverrides.find(({ id }) => id === "water");
  assert.equal(lightWater?.action, "hide", "satellite water override is theme-independent");

  // Plain mode must produce recolor (not hide), confirming mode-branching works.
  const plainOverrides = getWaterColorOverrides(layers, "light", "plain");
  const plainWater = plainOverrides.find(({ id }) => id === "water");
  assert.equal(plainWater?.action, "recolor", "plain mode must produce recolor, not hide");
});

test("reapplies custom layers after a replacement style finishes loading", () => {
  let styleLoadListener: (() => void) | undefined;
  let synchronizations = 0;
  const map = {
    isStyleLoaded: () => false,
    on: (_event: "style.load", listener: () => void) => {
      styleLoadListener = listener;
    },
    off: (_event: "style.load", listener: () => void) => {
      if (styleLoadListener === listener) styleLoadListener = undefined;
    },
  };

  const stopObserving = observeStyleReady(map, () => {
    synchronizations += 1;
  });
  assert.equal(synchronizations, 0);

  styleLoadListener?.();
  assert.equal(synchronizations, 1);

  stopObserving();
  assert.equal(styleLoadListener, undefined);
});

// ---------------------------------------------------------------------------
// computeDetailCameraTarget
// ---------------------------------------------------------------------------

/** Build a FeatureCollection of Polygon squares centred at the given points. */
function makePolygonFC(
  points: Array<{ lng: number; lat: number; halfDeg?: number }>,
): GeoJSON.FeatureCollection<GeoJSON.Geometry> {
  const features: GeoJSON.Feature<GeoJSON.Geometry>[] = points.map(({ lng, lat, halfDeg = 0.002 }) => ({
    type: "Feature" as const,
    geometry: {
      type: "Polygon" as const,
      coordinates: [[
        [lng - halfDeg, lat - halfDeg],
        [lng + halfDeg, lat - halfDeg],
        [lng + halfDeg, lat + halfDeg],
        [lng - halfDeg, lat + halfDeg],
        [lng - halfDeg, lat - halfDeg],
      ]],
    },
    properties: {},
  }));
  return { type: "FeatureCollection", features };
}

/**
 * Build a MultiPolygon that straddles the antimeridian (the way viirs.ts does):
 * one polygon at [west, east_of_antimeridian] = [+179.9x, +180] and
 * another at [-180, west_of_antimeridian] = [-180, -179.9x].
 *
 * Total physical width matches halfDeg*2 on each side (i.e., a 375 m square
 * split into two slivers at the antimeridian).
 */
function makeAntimeridianMultiPolygonFC(
  centerLng: number,
  centerLat: number,
  halfDeg: number,
): GeoJSON.FeatureCollection<GeoJSON.Geometry> {
  const west = centerLng - halfDeg;
  const east = centerLng + halfDeg;
  const south = centerLat - halfDeg;
  const north = centerLat + halfDeg;

  // Clamp to [-180, 180] and split at the antimeridian as viirs.ts does.
  const parts: number[][][][] = [];
  if (east > 180) {
    parts.push([[
      [west, south], [180, south], [180, north], [west, north], [west, south],
    ]]);
    parts.push([[
      [-180, south], [east - 360, south], [east - 360, north], [-180, north], [-180, south],
    ]]);
  } else if (west < -180) {
    parts.push([[
      [west + 360, south], [180, south], [180, north], [west + 360, north], [west + 360, south],
    ]]);
    parts.push([[
      [-180, south], [east, south], [east, north], [-180, north], [-180, south],
    ]]);
  } else {
    // Shouldn't happen in a well-formed antimeridian test, but fall back safely.
    parts.push([[
      [west, south], [east, south], [east, north], [west, north], [west, south],
    ]]);
  }

  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: parts },
      properties: {},
    }],
  };
}

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const DESKTOP_PADDING = getCameraPadding({ viewportWidth: DESKTOP_VIEWPORT.width, viewportHeight: DESKTOP_VIEWPORT.height, panelOpen: true });

test("computeDetailCameraTarget returns null for an empty FeatureCollection", () => {
  const fc: GeoJSON.FeatureCollection<GeoJSON.Geometry> = { type: "FeatureCollection", features: [] };
  assert.equal(
    computeDetailCameraTarget(fc, DESKTOP_PADDING, DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height),
    null,
  );
});

test("computeDetailCameraTarget frames a wide multi-pixel mosaic inside DETAIL_MOSAIC_MAX_ZOOM", () => {
  // Simulate the Mirninsky Ulus fire: bbox ~0.28° x 0.18°, many detections.
  // Construct a bounding rectangle by placing points at the corners.
  const westLng = 107.522;
  const eastLng = 107.807;
  const southLat = 65.595;
  const northLat = 65.776;
  const fc = makePolygonFC([
    { lng: westLng, lat: southLat },
    { lng: eastLng, lat: northLat },
    { lng: (westLng + eastLng) / 2, lat: (southLat + northLat) / 2 },
  ]);

  const result = computeDetailCameraTarget(fc, DESKTOP_PADDING, DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);

  assert.ok(result !== null, "should return a target for a non-empty mosaic");
  // Center should be roughly the midpoint of the bbox.
  assert.ok(
    Math.abs(result.center.lng - (westLng + eastLng) / 2) < 0.05,
    `center longitude should be near ${(westLng + eastLng) / 2}, got ${result.center.lng}`,
  );
  assert.ok(
    Math.abs(result.center.lat - (southLat + northLat) / 2) < 0.05,
    `center latitude should be near ${(southLat + northLat) / 2}, got ${result.center.lat}`,
  );
  // A 0.28° x 0.18° extent at ~65° lat on a desktop viewport should produce
  // a zoom that is framing the mosaic, not hitting either clamp — prove the
  // formula is actually computing a fit, not just pinning to a limit.
  assert.ok(
    result.zoom > DETAIL_MOSAIC_MIN_ZOOM,
    `zoom ${result.zoom} should exceed DETAIL_MOSAIC_MIN_ZOOM (${DETAIL_MOSAIC_MIN_ZOOM})`,
  );
  assert.ok(
    result.zoom < DETAIL_MOSAIC_MAX_ZOOM,
    `zoom ${result.zoom} should be below DETAIL_MOSAIC_MAX_ZOOM (${DETAIL_MOSAIC_MAX_ZOOM}) for a wide mosaic — the formula must be framing, not clamping`,
  );
});

test("computeDetailCameraTarget clamps a single-pixel fire to DETAIL_MOSAIC_MAX_ZOOM", () => {
  // A single VIIRS pixel is a 375 m square — roughly 0.0034° wide at the equator.
  // The raw fit zoom would be very high; the clamp must cap it at DETAIL_MOSAIC_MAX_ZOOM.
  const fc = makePolygonFC([{ lng: -8.6, lat: 40.2, halfDeg: 0.0017 }]);

  const result = computeDetailCameraTarget(fc, DESKTOP_PADDING, DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);

  assert.ok(result !== null, "should return a target for a single-pixel fire");
  assert.equal(
    result.zoom,
    DETAIL_MOSAIC_MAX_ZOOM,
    `a lone VIIRS pixel must hit the max-zoom clamp (${DETAIL_MOSAIC_MAX_ZOOM}), got ${result.zoom}`,
  );
  // Center should be very close to the pixel's centre.
  assert.ok(Math.abs(result.center.lng - (-8.6)) < 0.01);
  assert.ok(Math.abs(result.center.lat - 40.2) < 0.01);
});






test("computeDetailCameraTarget handles an antimeridian-crossing mosaic without ~360° span", () => {
  // A fire centred at 179.999°E — the pixel straddles the antimeridian and is
  // represented as a MultiPolygon with one part near +180 and one near -180.
  const centerLng = 179.999;
  const centerLat = 10.0;
  const halfDeg = 0.002; // ~200 m at equator, well under a full pixel

  const fc = makeAntimeridianMultiPolygonFC(centerLng, centerLat, halfDeg);

  const result = computeDetailCameraTarget(fc, DESKTOP_PADDING, DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);

  assert.ok(result !== null, "should return a target for antimeridian fire");

  // The computed zoom must NOT hit the minimum (which would mean we accidentally
  // measured a ~360° bbox instead of the true ~0.004° wide pixel).
  assert.ok(
    result.zoom > DETAIL_MOSAIC_MIN_ZOOM,
    `antimeridian fire produced zoom ${result.zoom} which hit the floor — bounding box was probably ~360° wide (bug)`,
  );
  // Must still be at the max-zoom clamp since it's a single tiny pixel.
  assert.equal(
    result.zoom,
    DETAIL_MOSAIC_MAX_ZOOM,
    `antimeridian single pixel should clamp to DETAIL_MOSAIC_MAX_ZOOM (${DETAIL_MOSAIC_MAX_ZOOM}), got ${result.zoom}`,
  );
  // Center longitude must be within [-180, 180] and near the fire (unwrapped).
  assert.ok(
    result.center.lng >= -180 && result.center.lng <= 180,
    `center longitude ${result.center.lng} must be in [-180, 180]`,
  );
});
