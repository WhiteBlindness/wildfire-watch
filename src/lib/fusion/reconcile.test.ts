import assert from "node:assert/strict";
import test from "node:test";
import type { OperationalIncident } from "@/lib/wildfire/types";
import { MATCH_RULES, reconcile, type FusionObservation } from "./reconcile";

const NOW = Date.parse("2026-08-12T15:00:00Z");
const HOUR = 3_600_000;
// At latitude 40°, 0.01° of latitude is about 1.11 km and 0.01° of longitude about 0.85 km.
const BASE = { lat: 40.2, lng: -8.05 };

function incident(id: string, offset: { dLat?: number; dLng?: number } = {}, startedAgoHours = 4): OperationalIncident {
  return {
    kind: "operational_incident",
    id: `anepc:${id}`,
    datasetId: "anepc:ocorrencias-em-aberto",
    sourceId: id,
    location: { lat: BASE.lat + (offset.dLat ?? 0), lng: BASE.lng + (offset.dLng ?? 0) },
    phase: "in_progress",
    phaseLabel: "Em Curso",
    natureCode: "3101",
    natureLabel: null,
    startedAt: new Date(NOW - startedAgoHours * HOUR).toISOString(),
    updatedAt: null,
    municipality: null,
    parish: null,
    resources: { personnel: null, groundVehicles: null, aircraft: null },
  };
}

function detection(id: string, offset: { dLat?: number; dLng?: number } = {}, acquiredAgoHours = 1, frpMw = 20): FusionObservation {
  return {
    id,
    location: { lat: BASE.lat + (offset.dLat ?? 0), lng: BASE.lng + (offset.dLng ?? 0) },
    acquiredAt: new Date(NOW - acquiredAgoHours * HOUR).toISOString(),
    frpMw,
  };
}

test("the rules are explicit and published with every result", () => {
  const result = reconcile([], [], NOW);
  assert.deepEqual(result.rules, MATCH_RULES);
  assert.deepEqual(MATCH_RULES, { matchRadiusKm: 5, ambiguityMarginKm: 1, preReportWindowHours: 6, recentDetectionHours: 12 });
});

test("a detection near an incident, after it started, is linked to it with its distance", () => {
  const result = reconcile([incident("1")], [detection("d1", { dLat: 0.007 })], NOW);
  assert.deepEqual(result.detections, [{ detectionId: "d1", status: "matched", incidentIds: ["anepc:1"], distanceKm: 0.8 }]);
  assert.deepEqual(result.incidents, [{
    incidentId: "anepc:1",
    matchedDetectionIds: ["d1"],
    ambiguousDetectionIds: [],
    nearestDetectionKm: 0.8,
    latestDetectionAt: new Date(NOW - HOUR).toISOString(),
    maxFrpMw: 20,
    satellite: "recent",
  }]);
});

test("a detection farther than the radius is not linked; the incident has no satellite evidence", () => {
  const result = reconcile([incident("1")], [detection("far", { dLat: 0.06 })], NOW);
  assert.deepEqual(result.detections, []);
  assert.equal(result.incidents[0].satellite, "none");
  assert.equal(result.incidents[0].nearestDetectionKm, null);
});

test("several detections can belong to one incident", () => {
  const result = reconcile([incident("1")], [
    detection("a", { dLat: 0.01 }, 1, 12),
    detection("b", { dLng: -0.02 }, 2, 140),
    detection("c", { dLat: -0.015 }, 0.5, 33),
  ], NOW);
  const [evidence] = result.incidents;
  assert.deepEqual(evidence.matchedDetectionIds, ["c", "a", "b"], "newest first");
  assert.equal(evidence.maxFrpMw, 140);
  assert.equal(evidence.latestDetectionAt, new Date(NOW - 0.5 * HOUR).toISOString());
  assert.equal(evidence.nearestDetectionKm, 1.1);
});

test("heat seen well before the occurrence was registered belongs to something else", () => {
  const result = reconcile([incident("1", {}, 4)], [
    detection("before-window", { dLat: 0.001 }, 4 + 7),
    detection("inside-window", { dLat: 0.001 }, 4 + 5),
  ], NOW);
  assert.deepEqual(result.incidents[0].matchedDetectionIds, ["inside-window"]);
});

test("old matched detections mean no recent satellite evidence, not none", () => {
  const result = reconcile([incident("1", {}, 30)], [detection("old", { dLat: 0.005 }, 20)], NOW);
  assert.equal(result.incidents[0].satellite, "earlier");
});

test("a detection between two incidents at similar distances is ambiguous and linked to neither", () => {
  const result = reconcile(
    [incident("north", { dLat: 0.011 }), incident("south", { dLat: -0.017 })],
    [detection("between")],
    NOW,
  );
  assert.deepEqual(result.detections, [{ detectionId: "between", status: "ambiguous", incidentIds: ["anepc:north", "anepc:south"], distanceKm: 1.2 }]);
  for (const evidence of result.incidents) {
    assert.deepEqual(evidence.matchedDetectionIds, []);
    assert.deepEqual(evidence.ambiguousDetectionIds, ["between"]);
    assert.equal(evidence.satellite, "none");
  }
});

test("a clearly nearer incident wins", () => {
  const result = reconcile(
    [incident("near", { dLat: 0.004 }), incident("far", { dLat: -0.03 })],
    [detection("d")],
    NOW,
  );
  assert.deepEqual(result.detections[0], { detectionId: "d", status: "matched", incidentIds: ["anepc:near"], distanceKm: 0.4 });
});

test("an exact tie is ambiguous, never decided by input order", () => {
  const result = reconcile([incident("a", { dLat: 0.01 }), incident("b", { dLat: -0.01 })], [detection("d")], NOW);
  assert.equal(result.detections[0].status, "ambiguous");
  assert.deepEqual(result.detections[0].incidentIds, ["anepc:a", "anepc:b"]);
});

test("the result does not depend on input order and ignores duplicate observations", () => {
  const incidents = [incident("1"), incident("2", { dLat: 0.2 })];
  const observations = [detection("x", { dLat: 0.01 }), detection("y", { dLat: 0.19 }), detection("z", { dLng: 0.01 })];
  const forward = reconcile(incidents, observations, NOW);
  const reversed = reconcile([...incidents].reverse(), [...observations, observations[0]].reverse(), NOW);
  assert.deepEqual(reversed, forward);
});
