import assert from "node:assert/strict";
import test from "node:test";
import {
  SATELLITE_BACKGROUND,
  getCameraPadding,
  getMapStyleUrl,
  getSatelliteLayerPlan,
  observeStyleReady,
} from "./mapPresentation";

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

test("plans the ocean mask above imagery and a visible bottom background", () => {
  assert.equal(SATELLITE_BACKGROUND, "#051937");
  const plan = getSatelliteLayerPlan([
    { id: "background", type: "background" },
    { id: "water", type: "fill", source: "carto", "source-layer": "water", filter: ["==", ["get", "class"], "ocean"] },
    { id: "country-label", type: "symbol", source: "carto", "source-layer": "place" },
  ]);

  assert.equal(plan.backgroundBeforeLayerId, "water");
  assert.equal(plan.overlayBeforeLayerId, "country-label");
  assert.deepEqual(plan.oceanLayer, {
    source: "carto",
    sourceLayer: "water",
    filter: ["==", ["get", "class"], "ocean"],
  });
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
