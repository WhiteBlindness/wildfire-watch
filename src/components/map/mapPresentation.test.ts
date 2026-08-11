import assert from "node:assert/strict";
import test from "node:test";
import {
  getCameraPadding,
  getMapStyleUrl,
  getSatelliteLayerPlan,
  observeStyleReady,
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
      paint: { "background-color": "#051937" },
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
