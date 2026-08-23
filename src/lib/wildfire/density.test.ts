import assert from "node:assert/strict";
import test from "node:test";
import type { DensityPoint } from "./density";
import {
  DEFAULT_HALF_LIFE_HOURS,
  FRP_REF_MW,
  WEIGHT_FLOOR,
  computeDensityWeight,
  eventsToDensityPoints,
  pointsToThermalDensityGeoJSON,
} from "./density";
import type { WildfireEvent } from "./types";

const NOW = Date.parse("2026-08-22T12:00:00.000Z");

function makePoint(overrides: Partial<DensityPoint> = {}): DensityPoint {
  return {
    id: "firms-abc123",
    lat: 40.2,
    lng: -8.6,
    frpMw: 55,
    confidencePct: 90,
    detectedAt: "2026-08-22T12:00:00.000Z",
    ...overrides,
  };
}

function isoHoursAgo(hours: number): string {
  return new Date(NOW - hours * 3_600_000).toISOString();
}

// ---------------------------------------------------------------------------
// computeDensityWeight
// ---------------------------------------------------------------------------

test("fresh high-FRP high-confidence detection gets weight near 1", () => {
  const weight = computeDensityWeight(150, 90, 0, DEFAULT_HALF_LIFE_HOURS);
  assert.ok(weight > 0.9, `expected weight near 1, got ${weight}`);
  assert.ok(weight <= 1);
});

test("old low-FRP low-confidence detection gets a small weight, and ordering holds", () => {
  const freshStrong = computeDensityWeight(150, 90, 0, DEFAULT_HALF_LIFE_HOURS);
  const oldWeak = computeDensityWeight(2, 30, 24 * 10, DEFAULT_HALF_LIFE_HOURS);

  assert.ok(oldWeak < freshStrong, "old weak detection must weigh less than fresh strong one");
  assert.ok(oldWeak >= WEIGHT_FLOOR, "weight must never fall below the documented floor");
  assert.ok(oldWeak < 0.3, `expected a small weight, got ${oldWeak}`);
});

test("recency: ageHours=0 vs ageHours=halfLife halves the recency contribution", () => {
  // Isolate recency by holding FRP and confidence fixed (confidence pinned to
  // the "high" 90 level so confidenceFactor = 1, and FRP fixed).
  const frpMw = 40;
  const confidencePct = 90;

  const atZero = computeDensityWeight(frpMw, confidencePct, 0, 24);
  const atHalfLife = computeDensityWeight(frpMw, confidencePct, 24, 24);

  // weight = frpComponent * recency * confidenceFactor (before floor clamp).
  // Both are comfortably above WEIGHT_FLOOR here so the clamp does not distort
  // the ratio: atHalfLife should be ~half of atZero.
  assert.ok(atHalfLife > WEIGHT_FLOOR, "test fixture must stay above the floor to observe the halving");
  const ratio = atHalfLife / atZero;
  assert.ok(Math.abs(ratio - 0.5) < 0.01, `expected recency to halve at one half-life, ratio=${ratio}`);
});

test("FRP is log-compressed: doubling FRP does not double weight", () => {
  const low = computeDensityWeight(10, 90, 0, DEFAULT_HALF_LIFE_HOURS);
  const doubled = computeDensityWeight(20, 90, 0, DEFAULT_HALF_LIFE_HOURS);

  assert.ok(doubled > low, "more FRP must still weigh more");
  const ratio = doubled / low;
  assert.ok(ratio < 2, `log-compression must prevent a 2x FRP change from producing a >=2x weight, ratio=${ratio}`);
});

test("FRP component saturates near 1 around FRP_REF_MW and stays clamped above it", () => {
  const atRef = computeDensityWeight(FRP_REF_MW, 90, 0, DEFAULT_HALF_LIFE_HOURS);
  const wellAboveRef = computeDensityWeight(FRP_REF_MW * 10, 90, 0, DEFAULT_HALF_LIFE_HOURS);

  assert.ok(atRef > 0.95, `expected near-saturation at FRP_REF_MW, got ${atRef}`);
  assert.ok(wellAboveRef <= 1, "weight must never exceed 1");
});

test("confidence factor snaps to the nearest categorical VIIRS level", () => {
  const low = computeDensityWeight(40, 30, 0, DEFAULT_HALF_LIFE_HOURS);
  const nominal = computeDensityWeight(40, 65, 0, DEFAULT_HALF_LIFE_HOURS);
  const high = computeDensityWeight(40, 90, 0, DEFAULT_HALF_LIFE_HOURS);

  assert.ok(low < nominal, "low confidence must weigh less than nominal");
  assert.ok(nominal < high, "nominal confidence must weigh less than high");

  // A value close to a category (e.g. 92) should snap to that category (90),
  // producing the same weight as an exact 90 reading.
  const nearHigh = computeDensityWeight(40, 92, 0, DEFAULT_HALF_LIFE_HOURS);
  assert.equal(nearHigh, high, "confidencePct near 90 must snap to the high-confidence level");
});

test("weight never drops below the documented floor, even for near-zero inputs", () => {
  const weight = computeDensityWeight(0, 30, 24 * 365, DEFAULT_HALF_LIFE_HOURS);
  assert.equal(weight, WEIGHT_FLOOR);
});

// ---------------------------------------------------------------------------
// pointsToThermalDensityGeoJSON
// ---------------------------------------------------------------------------

test("emits one feature per valid input point with no grid dedup", () => {
  const points: DensityPoint[] = [
    makePoint({ id: "a", lat: 40.2, lng: -8.6 }),
    makePoint({ id: "b", lat: 40.2001, lng: -8.5999 }),
    makePoint({ id: "c", lat: 40.20005, lng: -8.60005 }),
  ];

  const result = pointsToThermalDensityGeoJSON(points, { nowMs: NOW });

  assert.equal(result.type, "FeatureCollection");
  assert.equal(result.features.length, 3);
  for (const feature of result.features) {
    assert.equal(feature.geometry.type, "Point");
  }
});

test("invalid coordinates are dropped and feature count matches valid inputs", () => {
  const points: DensityPoint[] = [
    makePoint({ id: "valid-1", lat: 40.2, lng: -8.6 }),
    makePoint({ id: "invalid-lat-high", lat: 90, lng: 0 }),
    makePoint({ id: "invalid-lat-low", lat: -90, lng: 0 }),
    makePoint({ id: "invalid-lng-high", lat: 0, lng: 181 }),
    makePoint({ id: "invalid-lng-low", lat: 0, lng: -181 }),
    makePoint({ id: "invalid-nan-lat", lat: Number.NaN, lng: 0 }),
    makePoint({ id: "valid-2", lat: 41.0, lng: -9.0 }),
  ];

  const result = pointsToThermalDensityGeoJSON(points, { nowMs: NOW });

  assert.equal(result.features.length, 2);
});

test("distinct nearby raw inputs stay distinct — no grid-snap lattice", () => {
  // Two points close enough that a 375 m grid snap (viirs.ts's approach) would
  // collapse them to the same cell centre. The density module must keep them
  // as two separate coordinates.
  const points: DensityPoint[] = [
    makePoint({ id: "near-a", lat: 40.2000, lng: -8.6000 }),
    makePoint({ id: "near-b", lat: 40.2001, lng: -8.5999 }),
  ];

  const result = pointsToThermalDensityGeoJSON(points, { nowMs: NOW });

  assert.equal(result.features.length, 2);
  const [first, second] = result.features;
  const firstCoords = first.geometry.type === "Point" ? first.geometry.coordinates : null;
  const secondCoords = second.geometry.type === "Point" ? second.geometry.coordinates : null;
  assert.ok(firstCoords && secondCoords, "both features must be Points");
  assert.notDeepEqual(firstCoords, secondCoords, "distinct raw inputs must not collapse to one snapped coordinate");
});

test("properties carry weight, source fields, and ageHours", () => {
  const detectedAt = isoHoursAgo(6);
  const points: DensityPoint[] = [
    makePoint({ id: "p1", frpMw: 75, confidencePct: 65, detectedAt }),
  ];

  const result = pointsToThermalDensityGeoJSON(points, { nowMs: NOW });

  assert.equal(result.features.length, 1);
  const props = result.features[0].properties;
  assert.equal(props.frpMw, 75);
  assert.equal(props.confidencePct, 65);
  assert.equal(props.detectedAt, detectedAt);
  assert.ok(Math.abs(props.ageHours - 6) < 0.001, `expected ageHours ~= 6, got ${props.ageHours}`);
  assert.ok(props.weight > 0 && props.weight <= 1);
});

test("invalid detectedAt and future timestamps are guarded to ageHours = 0, not dropped", () => {
  const points: DensityPoint[] = [
    makePoint({ id: "bad-date", detectedAt: "not-a-real-date" }),
    makePoint({ id: "future-date", detectedAt: new Date(NOW + 3_600_000).toISOString() }),
  ];

  const result = pointsToThermalDensityGeoJSON(points, { nowMs: NOW });

  assert.equal(result.features.length, 2);
  for (const feature of result.features) {
    assert.equal(feature.properties.ageHours, 0);
  }
});

test("returns an empty collection for empty input", () => {
  assert.deepEqual(pointsToThermalDensityGeoJSON([], { nowMs: NOW }), {
    type: "FeatureCollection",
    features: [],
  });
});

test("coordinates are rounded to at most 5 decimal places", () => {
  const points: DensityPoint[] = [
    makePoint({ lat: 40.123456789, lng: -8.987654321 }),
  ];

  const result = pointsToThermalDensityGeoJSON(points, { nowMs: NOW });
  const geometry = result.features[0].geometry;
  assert.equal(geometry.type, "Point");
  if (geometry.type === "Point") {
    const [lng, lat] = geometry.coordinates;
    assert.equal(lng, Math.round(-8.987654321 * 100_000) / 100_000);
    assert.equal(lat, Math.round(40.123456789 * 100_000) / 100_000);
  }
});

// ---------------------------------------------------------------------------
// eventsToDensityPoints
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<WildfireEvent> = {}): WildfireEvent {
  return {
    id: "fire-1",
    name: "Thermal anomaly",
    country: "Portugal",
    region: "Centro",
    location: { lng: -8.6, lat: 40.2 },
    status: "active",
    severity: "high",
    startedAt: "2026-08-01T00:00:00.000Z",
    estimatedContainmentAt: null,
    containedAt: null,
    areaHectares: 0,
    polygon: null,
    heatmapPoints: [],
    wind: null,
    forces: null,
    internationalAid: null,
    evolution: null,
    maxFrpMw: 25,
    satelliteDetection: {
      frpMw: 25,
      confidencePct: 90,
      detectedAt: "2026-08-01T00:00:00.000Z",
    },
    source: "firms",
    lastUpdated: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

test("eventsToDensityPoints prefers satelliteDetection fields", () => {
  const event = makeEvent();
  const [densityPoint] = eventsToDensityPoints([event]);

  assert.equal(densityPoint.id, event.id);
  assert.equal(densityPoint.lat, event.location.lat);
  assert.equal(densityPoint.lng, event.location.lng);
  assert.equal(densityPoint.frpMw, 25);
  assert.equal(densityPoint.confidencePct, 90);
  assert.equal(densityPoint.detectedAt, "2026-08-01T00:00:00.000Z");
});

test("eventsToDensityPoints falls back to maxFrpMw and startedAt when satelliteDetection is null", () => {
  const event = makeEvent({
    maxFrpMw: 40,
    satelliteDetection: null,
    startedAt: "2026-07-15T00:00:00.000Z",
  });
  const [densityPoint] = eventsToDensityPoints([event]);

  assert.equal(densityPoint.frpMw, 40);
  assert.equal(densityPoint.confidencePct, 0);
  assert.equal(densityPoint.detectedAt, "2026-07-15T00:00:00.000Z");
});

test("eventsToDensityPoints falls back to 0 FRP when both satelliteDetection and maxFrpMw are absent", () => {
  const event = makeEvent({ maxFrpMw: null, satelliteDetection: null });
  const [densityPoint] = eventsToDensityPoints([event]);

  assert.equal(densityPoint.frpMw, 0);
});

test("eventsToDensityPoints output feeds directly into pointsToThermalDensityGeoJSON", () => {
  const events = [makeEvent({ id: "e1" }), makeEvent({ id: "e2", location: { lng: -9.1, lat: 38.7 } })];
  const densityPoints = eventsToDensityPoints(events);
  const result = pointsToThermalDensityGeoJSON(densityPoints, { nowMs: NOW });

  assert.equal(result.features.length, 2);
});
