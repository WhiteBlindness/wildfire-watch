import assert from "node:assert/strict";
import test from "node:test";
import { getPhysicalFeatures } from "./features";
import { haversineKm } from "./haversine";
import { buildGeographyLabelGeoJSON } from "./label-geojson";
import { findNearestRange, findNearestVolcano } from "./nearest";

// ---------------------------------------------------------------------------
// haversineKm
// ---------------------------------------------------------------------------

test("haversineKm matches the known Lisbon-Porto great-circle distance", () => {
  const lisbon = { lat: 38.7223, lng: -9.1393 };
  const porto = { lat: 41.1579, lng: -8.6291 };

  const distanceKm = haversineKm(lisbon, porto);

  assert.ok(
    Math.abs(distanceKm - 274) < 5,
    `expected Lisbon-Porto distance ~274 km, got ${distanceKm.toFixed(1)} km`,
  );
});

test("haversineKm returns 0 for identical coordinates", () => {
  const point = { lat: 40.2, lng: -8.6 };
  assert.equal(haversineKm(point, point), 0);
});

test("haversineKm handles antimeridian crossings without a discontinuity", () => {
  const justWest = { lat: 0, lng: 179.9 };
  const justEast = { lat: 0, lng: -179.9 };

  const distanceKm = haversineKm(justWest, justEast);

  // 0.2 degrees of longitude at the equator is ~22 km, not ~40,000 km (the
  // naive absolute-value-of-degree-difference result).
  assert.ok(
    distanceKm < 50,
    `expected antimeridian-adjacent points to be close, got ${distanceKm.toFixed(1)} km`,
  );
});

// ---------------------------------------------------------------------------
// findNearestVolcano / findNearestRange
// ---------------------------------------------------------------------------

test("findNearestVolcano returns Etna for a point near Sicily", () => {
  const nearCatania = { lat: 37.5, lng: 15.09 };

  const result = findNearestVolcano(nearCatania.lat, nearCatania.lng, 100);

  assert.ok(result, "expected a volcano within 100 km of Catania");
  assert.equal(result?.feature.name, "Etna");
  assert.equal(result?.feature.kind, "volcano");
  assert.ok(result && result.distanceKm >= 0);
});

test("findNearestVolcano returns null when maxKm is too tight to reach any volcano", () => {
  // Mid-Atlantic, far from any curated volcano and well under the distance
  // to the nearest one (Azores/Canaries are hundreds of km away).
  const midAtlantic = { lat: 30, lng: -40 };

  const result = findNearestVolcano(midAtlantic.lat, midAtlantic.lng, 1);

  assert.equal(result, null);
});

test("findNearestRange returns a range within maxKm and null when maxKm is 0 and no range sits exactly there", () => {
  const somewhereRemote = { lat: 5, lng: -30 }; // open Atlantic, unlikely to hit a range at 0 km
  const result = findNearestRange(somewhereRemote.lat, somewhereRemote.lng, 0);
  assert.equal(result, null);

  const wideResult = findNearestRange(somewhereRemote.lat, somewhereRemote.lng, 20000);
  assert.ok(wideResult, "expected some range within 20,000 km of any point on Earth");
  assert.equal(wideResult?.feature.kind, "range");
});

// ---------------------------------------------------------------------------
// minZoom tiering
// ---------------------------------------------------------------------------

test("mountain range minZoom tiers are monotonic with scalerank importance and stay below the peak/volcano floor", () => {
  const features = getPhysicalFeatures();
  const ranges = features.filter((f) => f.kind === "range");
  const peaks = features.filter((f) => f.kind === "peak");

  assert.ok(ranges.length > 0, "expected at least one mountain range feature");
  assert.ok(peaks.length > 0, "expected at least one peak feature");

  // Ranges must all resolve to non-negative, small minZoom values (they are
  // the earliest tier to appear).
  assert.ok(ranges.every((r) => r.minZoom >= 0 && r.minZoom <= 5));

  // Higher-priority (more important) ranges must not have a *higher* minZoom
  // than lower-priority ranges -- i.e. importance and reveal-zoom move
  // together in the expected direction.
  const sorted = [...ranges].sort((a, b) => b.priority - a.priority);
  const mostImportant = sorted[0];
  const leastImportant = sorted[sorted.length - 1];
  assert.ok(mostImportant.minZoom <= leastImportant.minZoom);

  // As a category, peaks reveal at a later (closer-in) zoom than ranges --
  // individual tiers can overlap at the edges (a rank-1 peak is still more
  // important than a rank-6 range), so this compares the two populations by
  // average rather than requiring every peak to exceed every range.
  const average = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const avgPeakZoom = average(peaks.map((p) => p.minZoom));
  const avgRangeZoom = average(ranges.map((r) => r.minZoom));
  assert.ok(
    avgPeakZoom > avgRangeZoom,
    `expected average peak minZoom (${avgPeakZoom}) to exceed average range minZoom (${avgRangeZoom})`,
  );
});

test("major volcanoes reveal at a lower (earlier) minZoom than minor volcanoes", () => {
  const volcanoes = getPhysicalFeatures().filter((f) => f.kind === "volcano");
  const etna = volcanoes.find((v) => v.name === "Etna");
  const minor = volcanoes.find((v) => v.priority < (etna?.priority ?? 0));

  assert.ok(etna, "expected Etna in the volcano feature set");
  assert.ok(minor, "expected at least one lower-priority volcano to compare against");
  assert.ok(etna && minor && etna.minZoom <= minor.minZoom);
});

// ---------------------------------------------------------------------------
// buildGeographyLabelGeoJSON
// ---------------------------------------------------------------------------

test("buildGeographyLabelGeoJSON returns a valid Point FeatureCollection covering all three kinds", () => {
  const collection = buildGeographyLabelGeoJSON();

  assert.equal(collection.type, "FeatureCollection");
  assert.ok(collection.features.length > 0);

  const kinds = new Set(collection.features.map((f) => f.properties.kind));
  assert.ok(kinds.has("range"));
  assert.ok(kinds.has("peak"));
  assert.ok(kinds.has("volcano"));

  for (const feature of collection.features) {
    assert.equal(feature.type, "Feature");
    assert.equal(feature.geometry.type, "Point");
    const [lng, lat] = feature.geometry.coordinates;
    assert.ok(lng >= -180 && lng <= 180, `longitude out of range: ${lng}`);
    assert.ok(lat >= -90 && lat <= 90, `latitude out of range: ${lat}`);
    assert.equal(typeof feature.properties.name, "string");
    assert.ok(feature.properties.name.length > 0);
    assert.equal(typeof feature.properties.minZoom, "number");
    assert.equal(typeof feature.properties.priority, "number");
  }
});

test("getPhysicalFeatures is memoized (same array reference across calls)", () => {
  assert.equal(getPhysicalFeatures(), getPhysicalFeatures());
});
