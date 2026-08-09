import assert from "node:assert/strict";
import test from "node:test";
import { distance, point } from "@turf/turf";
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
