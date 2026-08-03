import assert from "node:assert/strict";
import test from "node:test";
import type { WildfireEvent } from "./types";
import { eventsToTemporalMarkerGeoJSON, timelineCutoffTimestamp } from "./temporal";

function event(id: string, detectedAt: string): WildfireEvent {
  return {
    id,
    name: "Satellite thermal anomaly",
    country: "Test country",
    region: "Test region",
    location: { lng: -9, lat: 39 },
    status: "active",
    severity: "moderate",
    startedAt: detectedAt,
    estimatedContainmentAt: null,
    containedAt: null,
    areaHectares: 0,
    polygon: null,
    heatmapPoints: [{ lng: -9, lat: 39, intensity: 0.5, detectedAt }],
    wind: null,
    forces: null,
    internationalAid: null,
    evolution: null,
    maxFrpMw: 25,
    satelliteDetection: { frpMw: 25, confidencePct: 90, detectedAt },
    source: "firms",
    lastUpdated: detectedAt,
  };
}

test("timeline frames include only FIRMS detections acquired by the cutoff", () => {
  const older = event("older", "2026-08-01T12:00:00.000Z");
  const latest = event("latest", "2026-08-03T00:00:00.000Z");
  const events = [latest, older];

  assert.equal(timelineCutoffTimestamp(events, 36), Date.parse(older.satelliteDetection!.detectedAt));
  assert.deepEqual(
    [0, 36, 72].map((hour) => eventsToTemporalMarkerGeoJSON(events, hour).features.length),
    [0, 1, 2],
  );
  assert.equal(eventsToTemporalMarkerGeoJSON(events, 35).features.length, 0);
});

test("temporal GeoJSON carries a numeric acquisition timestamp on every point", () => {
  const detectedAt = "2026-08-02T06:30:00.000Z";
  const collection = eventsToTemporalMarkerGeoJSON([event("point", detectedAt)], 72);

  assert.equal(collection.features.length, 1);
  assert.equal(collection.features[0].properties?.timestamp, Date.parse(detectedAt));
  assert.equal(collection.features[0].properties?.detectedAt, detectedAt);
});
