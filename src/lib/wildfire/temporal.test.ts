import assert from "node:assert/strict";
import test from "node:test";
import { thermalDetection } from "./detection.fixture";
import { detectionsToTemporalMarkerGeoJSON, timelineCutoffTimestamp } from "./temporal";

test("timeline frames include only FIRMS detections acquired by the cutoff", () => {
  const older = thermalDetection({ id: "older", acquiredAt: "2026-08-01T12:00:00.000Z" });
  const latest = thermalDetection({ id: "latest", acquiredAt: "2026-08-03T00:00:00.000Z" });
  const detections = [latest, older];

  assert.equal(timelineCutoffTimestamp(detections, 36), Date.parse(older.acquiredAt));
  assert.deepEqual(
    [0, 36, 72].map((hour) => detectionsToTemporalMarkerGeoJSON(detections, hour).features.length),
    [0, 1, 2],
  );
  assert.equal(detectionsToTemporalMarkerGeoJSON(detections, 35).features.length, 0);
});

test("temporal GeoJSON carries the acquisition time and the FRP band, never a severity", () => {
  const acquiredAt = "2026-08-02T06:30:00.000Z";
  const collection = detectionsToTemporalMarkerGeoJSON([thermalDetection({ id: "point", acquiredAt, frpMw: 60 })], 72);

  assert.equal(collection.features.length, 1);
  const properties = collection.features[0].properties ?? {};
  assert.equal(properties.timestamp, Date.parse(acquiredAt));
  assert.equal(properties.acquiredAt, acquiredAt);
  assert.equal(properties.detectionId, "point");
  assert.equal(properties.intensityBand, "high");
  assert.equal("severity" in properties, false);
  assert.equal("status" in properties, false);
});
