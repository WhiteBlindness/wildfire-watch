import assert from "node:assert/strict";
import test from "node:test";
import { bbox, bboxPolygon, buffer, distance, point } from "@turf/turf";
import type { WildfireEvent } from "./types";
import { VIIRS_PIXEL_SIDE_METERS, eventsToViirsPixelGeoJSON } from "./viirs";

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
  const event = makeEvent();
  const hotspot = event.heatmapPoints[0];
  const buffered = buffer(point([hotspot.lng, hotspot.lat]), 187.5, { units: "meters" });

  assert.ok(buffered, "Turf should buffer a valid VIIRS hotspot");
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
