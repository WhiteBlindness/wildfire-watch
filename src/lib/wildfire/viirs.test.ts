import assert from "node:assert/strict";
import test from "node:test";
import { bbox, bboxPolygon, buffer, distance, point } from "@turf/turf";
import type { CachedFirmsPoint } from "./firms-cache";
import type { WildfireEvent } from "./types";
import { VIIRS_PIXEL_SIDE_METERS, eventsToViirsPixelGeoJSON, pointsToViirsPixelGeoJSON } from "./viirs";

// Re-implement the grid snap helper for test assertions.  It mirrors the logic
// in viirs.ts so tests stay honest about what the snapped centre actually is.
const VIIRS_LAT_STEP_DEG = 375 / 111320;
function testSnapToGrid(lat: number, lng: number): { cellCentLat: number; cellCentLng: number } {
  const rowIndex = Math.round(lat / VIIRS_LAT_STEP_DEG);
  const cellCentLat = rowIndex * VIIRS_LAT_STEP_DEG;
  const cosLat = Math.cos((cellCentLat * Math.PI) / 180);
  const lngStep = 375 / (111320 * Math.max(cosLat, 1e-6));
  const colIndex = Math.round(lng / lngStep);
  const cellCentLng = colIndex * lngStep;
  return { cellCentLat, cellCentLng };
}

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
    heatmapPoints: [{
      lng: -8.6,
      lat: 40.2,
      intensity: 0.5,
      detectedAt: "2026-08-01T00:00:00.000Z",
    }],
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

test("creates one 375 m square for every raw selected hotspot", () => {
  const event = makeEvent({
    heatmapPoints: [
      { lng: -8.6, lat: 40.2, intensity: 0.5, detectedAt: "2026-08-01T00:00:00.000Z" },
      { lng: -8.59, lat: 40.2, intensity: 0.8, detectedAt: "2026-08-01T00:05:00.000Z" },
    ],
  });

  const result = eventsToViirsPixelGeoJSON([event], [event.id]);

  assert.equal(result.features.length, 2);
  assert.equal(result.features[0].geometry.type, "Polygon");
  assert.equal(result.features[0].properties?.fireId, event.id);
  assert.equal(result.features[0].properties?.frp, 25);

  const ring = result.features[0].geometry.type === "Polygon"
    ? result.features[0].geometry.coordinates[0]
    : [];
  assert.equal(ring.length, 5);
  assert.ok(Math.abs(
    distance(point(ring[0]), point(ring[1]), { units: "meters" }) - VIIRS_PIXEL_SIDE_METERS,
  ) < 1);
  assert.ok(Math.abs(
    distance(point(ring[1]), point(ring[2]), { units: "meters" }) - VIIRS_PIXEL_SIDE_METERS,
  ) < 1);
});

test("matches Turf's exact geodesic buffer, bbox, and bboxPolygon sequence", () => {
  // eventsToViirsPixelGeoJSON draws nominal-size pixels (no scan/track available
  // on the HeatmapPoint path) — so the pipeline must be byte-identical to the
  // original single-buffer sequence: buffer(187.5 m) → bbox → bboxPolygon.
  const event = makeEvent();
  const hotspot = event.heatmapPoints[0];
  const buffered = buffer(point([hotspot.lng, hotspot.lat]), 187.5, { units: "meters" });

  assert.ok(buffered, "Turf should buffer a valid VIIRS hotspot");
  // For the nominal (square) case, separate scan and track buffers are equal so
  // their combined bbox is identical to the single-buffer bbox.
  const expectedSquare = bboxPolygon(bbox(buffered));

  const result = eventsToViirsPixelGeoJSON([event], [event.id]);

  assert.deepEqual(result.features[0]?.geometry, expectedSquare.geometry);
});

test("keeps a VIIRS footprint physically 375 m square at high latitude", () => {
  const event = makeEvent({
    heatmapPoints: [{
      lng: 12,
      lat: 80,
      intensity: 0.5,
      detectedAt: "2026-08-01T00:00:00.000Z",
    }],
  });

  const result = eventsToViirsPixelGeoJSON([event], [event.id]);
  const geometry = result.features[0]?.geometry;
  assert.equal(geometry?.type, "Polygon");
  const ring = geometry?.type === "Polygon" ? geometry.coordinates[0] : [];

  assert.equal(ring.length, 5);
  for (let index = 0; index < 4; index += 1) {
    const sideMeters = distance(point(ring[index]), point(ring[index + 1]), { units: "meters" });
    assert.ok(
      Math.abs(sideMeters - VIIRS_PIXEL_SIDE_METERS) < 1,
      `expected side ${index + 1} to be 375 m at 80 degrees latitude, received ${sideMeters} m`,
    );
  }
});

test("keeps VIIRS footprints normalized and 375 m square across the antimeridian", () => {
  const event = makeEvent({
    heatmapPoints: [179.999, -179.999, 180, -180].map((lng) => ({
      lng,
      lat: 0,
      intensity: 0.5,
      detectedAt: "2026-08-01T00:00:00.000Z",
    })),
  });

  const result = eventsToViirsPixelGeoJSON([event], [event.id]);

  assert.equal(result.features.length, 4);
  for (const [featureIndex, feature] of result.features.entries()) {
    assert.equal(feature.geometry.type, "MultiPolygon");
    const rings = feature.geometry.type === "MultiPolygon"
      ? feature.geometry.coordinates.map((polygon) => polygon[0])
      : [];
    const centerLng = event.heatmapPoints[featureIndex].lng;
    const normalizedCenter = centerLng < 0 ? centerLng + 360 : centerLng;
    const positions = rings.flat();
    const unwrapped = positions.map(([lng, lat]) => [
      lng < normalizedCenter - 180 ? lng + 360 : lng,
      lat,
    ] as const);
    const longitudes = unwrapped.map(([lng]) => lng);
    const latitudes = unwrapped.map(([, lat]) => lat);
    const west = Math.min(...longitudes);
    const east = Math.max(...longitudes);
    const south = Math.min(...latitudes);
    const north = Math.max(...latitudes);

    assert.ok(positions.every(([lng]) => lng >= -180 && lng <= 180));
    assert.ok(rings.every((ring) => {
      const ringLongitudes = ring.map(([lng]) => lng);
      return Math.max(...ringLongitudes) - Math.min(...ringLongitudes) < 0.01;
    }), "each antimeridian part must remain local");

    const widthMeters = distance(point([west, south]), point([east, south]), { units: "meters" });
    const heightMeters = distance(point([west, south]), point([west, north]), { units: "meters" });
    assert.ok(Math.abs(widthMeters - VIIRS_PIXEL_SIDE_METERS) < 1);
    assert.ok(Math.abs(heightMeters - VIIRS_PIXEL_SIDE_METERS) < 1);
  }
});

test("drops polar coordinates outside MapLibre's representable latitude", () => {
  const event = makeEvent({
    heatmapPoints: [
      { lng: 0, lat: 90, intensity: 0.5, detectedAt: "2026-08-01T00:00:00.000Z" },
      { lng: 0, lat: -90, intensity: 0.5, detectedAt: "2026-08-01T00:00:00.000Z" },
    ],
  });

  assert.deepEqual(eventsToViirsPixelGeoJSON([event], [event.id]), {
    type: "FeatureCollection",
    features: [],
  });
});

test("filters malformed coordinates and safely derives fallback FRP", () => {
  const detectedAt = "2026-08-01T00:00:00.000Z";
  const event = makeEvent({
    maxFrpMw: null,
    satelliteDetection: null,
    heatmapPoints: [
      { lng: -8.6, lat: 40.2, intensity: 0.5, detectedAt },
      { lng: -8.61, lat: 40.2, intensity: Number.NaN, detectedAt },
      { lng: -8.62, lat: 40.2, intensity: -1, detectedAt },
      { lng: Number.NaN, lat: 40.2, intensity: 1, detectedAt },
      { lng: 181, lat: 40.2, intensity: 1, detectedAt },
      { lng: -181, lat: 40.2, intensity: 1, detectedAt },
      { lng: -8.6, lat: Number.NaN, intensity: 1, detectedAt },
    ],
  });

  const result = eventsToViirsPixelGeoJSON([event], [event.id]);

  assert.deepEqual(result.features.map((feature) => feature.properties.frpMw), [100, 0, 0]);
});

test("isolates selected event ids and keeps each event's FRP on its pixels", () => {
  const selected = makeEvent({
    id: "selected",
    maxFrpMw: 175,
    satelliteDetection: {
      frpMw: 175,
      confidencePct: 94,
      detectedAt: "2026-08-01T00:00:00.000Z",
    },
  });
  const unselected = makeEvent({ id: "unselected" });

  const result = eventsToViirsPixelGeoJSON([selected, unselected], [selected.id]);

  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties?.fireId, "selected");
  assert.equal(result.features[0].properties?.frp, 175);
});

test("returns an empty collection without a selected fire or raw points", () => {
  const event = makeEvent({ heatmapPoints: [] });

  assert.deepEqual(eventsToViirsPixelGeoJSON([event], []), {
    type: "FeatureCollection",
    features: [],
  });
  assert.deepEqual(eventsToViirsPixelGeoJSON([event], [event.id]), {
    type: "FeatureCollection",
    features: [],
  });
});

// ---------------------------------------------------------------------------
// pointsToViirsPixelGeoJSON tests
// ---------------------------------------------------------------------------

function makePoint(overrides: Partial<CachedFirmsPoint> = {}): CachedFirmsPoint {
  // scanKm / trackKm are intentionally absent in the base fixture so that tests
  // without explicit overrides exercise the nominal-fallback path.
  return {
    id: "firms-abc123",
    lat: 40.2,
    lng: -8.6,
    frpMw: 55,
    confidencePct: 90,
    detectedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

test("pointsToViirsPixelGeoJSON creates one 375 m square per detection point", () => {
  const points: CachedFirmsPoint[] = [
    makePoint({ id: "firms-1", lat: 40.2, lng: -8.6, frpMw: 55 }),
    makePoint({ id: "firms-2", lat: 40.21, lng: -8.59, frpMw: 120 }),
  ];

  const result = pointsToViirsPixelGeoJSON(points);

  assert.equal(result.type, "FeatureCollection");
  assert.equal(result.features.length, 2);
  assert.equal(result.features[0].geometry.type, "Polygon");
  assert.equal(result.features[1].geometry.type, "Polygon");
});

test("pointsToViirsPixelGeoJSON places per-point FRP on each feature", () => {
  const points: CachedFirmsPoint[] = [
    makePoint({ id: "firms-low", frpMw: 15 }),
    makePoint({ id: "firms-high", lat: 40.21, lng: -8.59, frpMw: 320 }),
    makePoint({ id: "firms-mid", lat: 40.22, lng: -8.58, frpMw: 88 }),
  ];

  const result = pointsToViirsPixelGeoJSON(points);

  assert.equal(result.features.length, 3);
  assert.equal(result.features[0].properties.frpMw, 15);
  assert.equal(result.features[0].properties.frp, 15);
  assert.equal(result.features[1].properties.frpMw, 320);
  assert.equal(result.features[1].properties.frp, 320);
  assert.equal(result.features[2].properties.frpMw, 88);
});

test("pointsToViirsPixelGeoJSON uses point.id as fireId", () => {
  const points: CachedFirmsPoint[] = [
    makePoint({ id: "firms-unique-id", frpMw: 42 }),
  ];

  const result = pointsToViirsPixelGeoJSON(points);

  assert.equal(result.features[0].properties.fireId, "firms-unique-id");
});

test("pointsToViirsPixelGeoJSON returns correct confidencePct and detectedAt", () => {
  const detectedAt = "2026-08-02T06:30:00.000Z";
  const points: CachedFirmsPoint[] = [
    makePoint({ confidencePct: 75, detectedAt }),
  ];

  const result = pointsToViirsPixelGeoJSON(points);

  assert.equal(result.features[0].properties.confidencePct, 75);
  assert.equal(result.features[0].properties.detectedAt, detectedAt);
});

test("pointsToViirsPixelGeoJSON drops polar coordinates outside MapLibre's range", () => {
  const points: CachedFirmsPoint[] = [
    makePoint({ lat: 90, lng: 0 }),
    makePoint({ lat: -90, lng: 0 }),
  ];

  const result = pointsToViirsPixelGeoJSON(points);

  assert.deepEqual(result, { type: "FeatureCollection", features: [] });
});

test("pointsToViirsPixelGeoJSON returns empty collection for empty input", () => {
  const result = pointsToViirsPixelGeoJSON([]);

  assert.deepEqual(result, { type: "FeatureCollection", features: [] });
});

test("pointsToViirsPixelGeoJSON produces 375 m squares matching the shared geometry pipeline (nominal, no scan/track)", () => {
  // Regression guard: a detection with no scan/track must produce the same
  // geometry as the original single-buffer pipeline — point → buffer(187.5 m)
  // → bbox → bboxPolygon — emitted at the snapped cell centre.
  const p = makePoint({ lat: 40.2, lng: -8.6 });
  const result = pointsToViirsPixelGeoJSON([p]);

  const { cellCentLat, cellCentLng } = testSnapToGrid(p.lat, p.lng);
  const buffered = buffer(point([cellCentLng, cellCentLat]), 187.5, { units: "meters" });
  assert.ok(buffered, "turf should buffer a valid VIIRS hotspot");
  // For the nominal square case the scan buffer = track buffer = single buffer,
  // so combined bbox equals the single-buffer bbox exactly.
  const expectedSquare = bboxPolygon(bbox(buffered));

  assert.deepEqual(result.features[0].geometry, expectedSquare.geometry);
});

test("pointsToViirsPixelGeoJSON with explicit nominal scan/track produces the same geometry as the no-scan/track path", () => {
  // A detection with scanKm=0.375 and trackKm=0.375 (the nadir nominal) must
  // produce byte-identical output to one with no scan/track fields at all.
  const { cellCentLat, cellCentLng } = testSnapToGrid(40.2, -8.6);
  const withNominal = makePoint({ lat: cellCentLat, lng: cellCentLng, scanKm: 0.375, trackKm: 0.375 });
  const withoutDims = makePoint({ lat: cellCentLat, lng: cellCentLng });

  const resultWith = pointsToViirsPixelGeoJSON([withNominal]);
  const resultWithout = pointsToViirsPixelGeoJSON([withoutDims]);

  assert.deepEqual(
    resultWith.features[0].geometry,
    resultWithout.features[0].geometry,
    "explicit nominal scan/track must match the no-field fallback geometry exactly",
  );
});

test("pointsToViirsPixelGeoJSON edge-of-swath detection (scan=0.65 km) draws a visibly wider E-W footprint", () => {
  // An edge-of-swath detection with scan=0.65 km should produce an E-W width
  // of 650 m while the N-S height stays at the nominal 375 m (track=0.375 km).
  // This confirms that scan/track are actually used rather than silently dropped.
  const p = makePoint({ lat: 40.2, lng: -8.6, scanKm: 0.65, trackKm: 0.375 });
  const result = pointsToViirsPixelGeoJSON([p]);

  assert.equal(result.features.length, 1);
  const geom = result.features[0].geometry;
  assert.equal(geom.type, "Polygon");

  if (geom.type === "Polygon") {
    const ring = geom.coordinates[0];
    // Ring layout from bboxPolygon: [SW, SE, NE, NW, SW]
    // E-W width: distance from SW to SE (or NW to NE).
    const ewWidthM = distance(point(ring[0]), point(ring[1]), { units: "meters" });
    // N-S height: distance from SW to NW (or SE to NE).
    const nsHeightM = distance(point(ring[0]), point(ring[3]), { units: "meters" });

    assert.ok(
      Math.abs(ewWidthM - 650) < 2,
      `expected E-W width ≈ 650 m for scan=0.65 km, got ${ewWidthM.toFixed(1)} m`,
    );
    assert.ok(
      Math.abs(nsHeightM - 375) < 2,
      `expected N-S height ≈ 375 m for track=0.375 km (nominal), got ${nsHeightM.toFixed(1)} m`,
    );
  }
});

test("pointsToViirsPixelGeoJSON detection with missing scan/track falls back to nominal 375 m square", () => {
  // A detection with no scanKm/trackKm fields must produce a 375 m × 375 m
  // square — the documented nominal nadir footprint.  This is the backward-
  // compat / deploy-gap guard: old KV payloads without these fields must render
  // identically to today's output.
  const p = makePoint({ lat: 40.2, lng: -8.6 });
  // Explicitly confirm the fixture has no scan/track fields.
  assert.equal(p.scanKm, undefined);
  assert.equal(p.trackKm, undefined);

  const result = pointsToViirsPixelGeoJSON([p]);
  assert.equal(result.features.length, 1);
  const geom = result.features[0].geometry;
  assert.equal(geom.type, "Polygon");

  if (geom.type === "Polygon") {
    const ring = geom.coordinates[0];
    for (let i = 0; i < 4; i += 1) {
      const sideM = distance(point(ring[i]), point(ring[i + 1]), { units: "meters" });
      assert.ok(
        Math.abs(sideM - 375) < 1,
        `missing scan/track: expected nominal side ${i + 1} = 375 m, got ${sideM.toFixed(2)} m`,
      );
    }
  }
});

test("pointsToViirsPixelGeoJSON per-point FRP varies independently across the collection", () => {
  // This test specifically guards against accidentally reading a shared/event-level
  // FRP instead of each point's own measured value.
  const frpValues = [10, 50, 150, 300, 5];
  const points: CachedFirmsPoint[] = frpValues.map((frpMw, i) =>
    makePoint({
      id: `firms-${i}`,
      lat: 40 + i * 0.01,
      lng: -8.6 + i * 0.01,
      frpMw,
    }),
  );

  const result = pointsToViirsPixelGeoJSON(points);

  assert.equal(result.features.length, frpValues.length);
  for (const [i, expectedFrp] of frpValues.entries()) {
    assert.equal(
      result.features[i].properties.frpMw,
      expectedFrp,
      `feature ${i} must carry its own FRP value`,
    );
    assert.equal(result.features[i].properties.frp, expectedFrp);
  }
});

// ---------------------------------------------------------------------------
// Grid-snapping tests (Defect A: "the squares are not aligned at all")
//
// VIIRS 375 m pixels land on at most ONE 375 m ground cell; multiple satellite
// overpasses firing on the same burn scar produce detections within one cell.
// These tests guard the deduplication logic and the edge-to-edge tiling property.
// ---------------------------------------------------------------------------

test("pointsToViirsPixelGeoJSON collapses detections from different overpasses in the same cell to one square with max FRP", () => {
  // Simulate two overpasses landing within one 375 m cell (~0.0034° × 0.0044°
  // at lat 40.2°).  We snap a base coordinate to its grid centre first, then
  // use the known cell centre as the origin for sub-cell offsets that are
  // guaranteed to remain within ±(pitch/3) in each axis.
  const baseLat = 40.2;
  const baseLng = -8.6;
  const { cellCentLat, cellCentLng } = testSnapToGrid(baseLat, baseLng);
  // Use the FIRMS 4-decimal rounding quantum (0.0001°) as the offset — it is
  // ~11 m, far below the 375 m pitch in both axes, so all three points
  // definitely snap to the same (rowIndex, colIndex).
  const points: CachedFirmsPoint[] = [
    makePoint({ id: "pass-a", lat: cellCentLat, lng: cellCentLng, frpMw: 35, confidencePct: 80, detectedAt: "2026-08-10T03:17:00.000Z" }),
    makePoint({ id: "pass-b", lat: cellCentLat + 0.0001, lng: cellCentLng + 0.0001, frpMw: 95, confidencePct: 90, detectedAt: "2026-08-10T18:41:00.000Z" }),
    makePoint({ id: "pass-c", lat: cellCentLat - 0.0001, lng: cellCentLng + 0.0002, frpMw: 60, confidencePct: 85, detectedAt: "2026-08-10T04:55:00.000Z" }),
  ];

  const result = pointsToViirsPixelGeoJSON(points);

  // Three raw detections in one cell → one output square.
  assert.equal(result.features.length, 1, "same-cell detections must collapse to one square");
  const props = result.features[0].properties;
  // Peak FRP wins.
  assert.equal(props.frpMw, 95, "collapsed cell must carry the maximum observed FRP");
  assert.equal(props.frp, 95);
  // Most recent detectedAt wins.
  assert.equal(props.detectedAt, "2026-08-10T18:41:00.000Z", "collapsed cell must carry the latest detectedAt");
  // Highest confidence wins.
  assert.equal(props.confidencePct, 90, "collapsed cell must carry the highest confidence");
});

test("pointsToViirsPixelGeoJSON adjacent cells produce squares that tile edge-to-edge without overlapping", () => {
  // Place detections in four adjacent cells: two in a horizontal pair (same
  // latitude row, consecutive column indices) and two in a vertical pair (same
  // longitude column, consecutive row indices).  After snapping and emitting at
  // cell centres, the east edge of the west cell must meet the west edge of the
  // east cell to sub-meter precision, and similarly for north/south.
  const lat = 40.2;
  const lng = -8.6;

  // Compute the grid step at this latitude to place the second point exactly
  // one column to the east and one row to the north.
  const latStep = 375 / 111320; // ≈ 0.003369°
  const rowIndex = Math.round(lat / latStep);
  const centLat = rowIndex * latStep;
  const cosLat = Math.cos((centLat * Math.PI) / 180);
  const lngStep = 375 / (111320 * Math.max(cosLat, 1e-6));

  // Horizontal pair: same row, columns colIndex and colIndex+1.
  const colIndex = Math.round(lng / lngStep);
  const centLng = colIndex * lngStep;
  const eastCentLng = (colIndex + 1) * lngStep;

  // Vertical pair: same column, rows rowIndex and rowIndex+1.
  const northCentLat = (rowIndex + 1) * latStep;

  const horizontalPair: CachedFirmsPoint[] = [
    makePoint({ id: "west", lat: centLat, lng: centLng, frpMw: 10 }),
    makePoint({ id: "east", lat: centLat, lng: eastCentLng, frpMw: 20 }),
  ];
  const verticalPair: CachedFirmsPoint[] = [
    makePoint({ id: "south", lat: centLat, lng: centLng, frpMw: 10 }),
    makePoint({ id: "north", lat: northCentLat, lng: centLng, frpMw: 20 }),
  ];

  // Horizontal tiling: the east boundary of the west cell == west boundary of the east cell.
  const hResult = pointsToViirsPixelGeoJSON(horizontalPair);
  assert.equal(hResult.features.length, 2, "horizontal pair should produce two distinct cells");
  const hWest = hResult.features[0].geometry;
  const hEast = hResult.features[1].geometry;
  // Both are Polygons; outer ring: [SW, SE, NE, NW, SW].
  assert.ok(hWest.type === "Polygon" && hEast.type === "Polygon", "both features must be Polygons");
  if (hWest.type === "Polygon" && hEast.type === "Polygon") {
    // West cell SE corner longitude vs. East cell SW corner longitude.
    const westEdge = hWest.coordinates[0][1][0];   // SE corner = ring[1], lng
    const eastEdge = hEast.coordinates[0][0][0];   // SW corner = ring[0], lng
    const gapM = distance(point([westEdge, centLat]), point([eastEdge, centLat]), { units: "meters" });
    assert.ok(
      gapM < 2,
      `horizontal cells must share an edge to within 2 m; gap = ${gapM.toFixed(2)} m`,
    );
  }

  // Vertical tiling: the north boundary of the south cell == south boundary of the north cell.
  const vResult = pointsToViirsPixelGeoJSON(verticalPair);
  assert.equal(vResult.features.length, 2, "vertical pair should produce two distinct cells");
  const vSouth = vResult.features[0].geometry;
  const vNorth = vResult.features[1].geometry;
  assert.ok(vSouth.type === "Polygon" && vNorth.type === "Polygon", "both features must be Polygons");
  if (vSouth.type === "Polygon" && vNorth.type === "Polygon") {
    // South cell NW corner latitude vs. North cell SW corner latitude.
    const southTop = vSouth.coordinates[0][3][1];  // NW corner = ring[3], lat
    const northBot = vNorth.coordinates[0][0][1];  // SW corner = ring[0], lat
    const gapM = distance(point([centLng, southTop]), point([centLng, northBot]), { units: "meters" });
    assert.ok(
      gapM < 2,
      `vertical cells must share an edge to within 2 m; gap = ${gapM.toFixed(2)} m`,
    );
  }
});

test("pointsToViirsPixelGeoJSON grid snapping holds at high latitude (80°N)", () => {
  // At 80° N the cosine correction makes lngStep much wider than at the equator
  // (lngStep ≈ 375/(111320·cos80°) ≈ 0.0193°, vs 0.00337° at the equator).
  // Snapping must still collapse co-cell detections and emit a valid 375 m square.
  const lat = 80.0;
  const lng = 12.0;
  const { cellCentLat, cellCentLng } = testSnapToGrid(lat, lng);
  // 0.0001° is ~11 m — far below both the lat pitch (0.003369°) and the
  // widened lng pitch at 80°N (≈0.019°), so these definitely share a cell.
  const points: CachedFirmsPoint[] = [
    makePoint({ id: "arctic-a", lat: cellCentLat, lng: cellCentLng, frpMw: 40 }),
    makePoint({ id: "arctic-b", lat: cellCentLat + 0.0001, lng: cellCentLng + 0.0001, frpMw: 80 }),
  ];

  const result = pointsToViirsPixelGeoJSON(points);

  assert.equal(result.features.length, 1, "sub-pitch offsets at 80°N must collapse to one cell");
  assert.equal(result.features[0].properties.frpMw, 80, "max FRP must be kept at high latitude");
  // The emitted square must be physically 375 m.
  const geom = result.features[0].geometry;
  assert.equal(geom.type, "Polygon");
  if (geom.type === "Polygon") {
    const ring = geom.coordinates[0];
    assert.equal(ring.length, 5);
    for (let idx = 0; idx < 4; idx += 1) {
      const sideM = distance(point(ring[idx]), point(ring[idx + 1]), { units: "meters" });
      assert.ok(
        Math.abs(sideM - VIIRS_PIXEL_SIDE_METERS) < 1,
        `side ${idx + 1} at 80°N must be 375 m; got ${sideM.toFixed(2)} m`,
      );
    }
  }
});

test("pointsToViirsPixelGeoJSON grid snapping holds across the antimeridian", () => {
  // Two detections placed exactly at the antimeridian boundary: ±180°.
  // The snapping pipeline must handle the wrap-around without throwing, and the
  // geometry pipeline must produce coordinate-valid output (all lng in [-180,180]).
  // Whether the output is a Polygon or MultiPolygon depends on whether the
  // snapped cell centre is close enough to ±180 to straddle — we do not assert
  // the specific geometry type here; that is already covered by the shared
  // makePixelPolygon tests (eventsToViirsPixelGeoJSON antimeridian test above).
  const points: CachedFirmsPoint[] = [
    makePoint({ id: "anti-east", lat: 0, lng: 179.999, frpMw: 55 }),
    makePoint({ id: "anti-west", lat: 0, lng: -179.999, frpMw: 70 }),
  ];

  const result = pointsToViirsPixelGeoJSON(points);

  // 179.999 and -179.999 are separated by 0.002° ≈ 222 m, which is less than
  // the 375 m lngStep at lat=0° (≈ 0.00337°) but they straddle ±180 so they
  // can never share a cell. Expect at least one feature.
  assert.ok(result.features.length >= 1, "antimeridian detections must produce at least one feature");

  // All coordinate longitudes must stay within [-180, 180] regardless of geometry type.
  for (const feature of result.features) {
    const geom = feature.geometry;
    if (geom.type === "Polygon") {
      assert.ok(
        geom.coordinates.every((ring) => ring.every(([lng]) => lng >= -180 && lng <= 180)),
        "Polygon coordinates must stay in [-180, 180]",
      );
    } else if (geom.type === "MultiPolygon") {
      const rings = geom.coordinates.flatMap((poly) => poly);
      assert.ok(
        rings.every((ring) => ring.every(([lng]) => lng >= -180 && lng <= 180)),
        "MultiPolygon coordinates must stay in [-180, 180]",
      );
    }
  }
});
