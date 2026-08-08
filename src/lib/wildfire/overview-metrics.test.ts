import assert from "node:assert/strict";
import test from "node:test";
import type { WildfireEvent } from "./types";
import { calculateOverviewMetrics, resolveEventIntensityMw } from "./overview-metrics";

function event(
  id: string,
  country: string,
  satelliteFrpMw: number | null,
  maxFrpMw: number | null,
): WildfireEvent {
  return {
    id,
    name: id,
    country,
    region: "Test region",
    location: { lng: -9, lat: 39 },
    status: "active",
    severity: "moderate",
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
    maxFrpMw,
    satelliteDetection: satelliteFrpMw === null
      ? null
      : { frpMw: satelliteFrpMw, confidencePct: 90, detectedAt: "2026-08-01T00:00:00.000Z" },
    source: "firms",
    lastUpdated: "2026-08-01T00:00:00.000Z",
  };
}

test("prefers valid point FRP and falls back to the event peak", () => {
  const point = event("point", "Portugal", 12, 90);
  const cluster = event("cluster", "Portugal", null, 8);

  assert.equal(resolveEventIntensityMw(point), 12);
  assert.equal(resolveEventIntensityMw(cluster), 8);
  assert.deepEqual(calculateOverviewMetrics([point, cluster]), {
    totalFrpMw: 20,
    maxFrpMw: 12,
    averageFrpMw: 10,
    projectedBurnAreaHectares: 8,
    validIntensityCount: 2,
  });
});

test("excludes missing, non-finite, and negative intensity values", () => {
  const invalidPoint = event("invalid-point", "Portugal", Number.NaN, -4);
  const validFallback = event("valid-fallback", "Portugal", -1, 5);
  const validPoint = event("valid-point", "Portugal", 0, 100);

  assert.equal(resolveEventIntensityMw(invalidPoint), null);
  assert.equal(resolveEventIntensityMw(validFallback), 5);
  assert.deepEqual(calculateOverviewMetrics([invalidPoint, validFallback, validPoint]), {
    totalFrpMw: 5,
    maxFrpMw: 5,
    averageFrpMw: 2.5,
    projectedBurnAreaHectares: 2,
    validIntensityCount: 2,
  });
});

test("returns null when no valid intensity is available and supports country subsets", () => {
  assert.equal(calculateOverviewMetrics([]), null);
  assert.equal(calculateOverviewMetrics([event("invalid", "Portugal", null, null)]), null);

  const portugal = event("pt", "Portugal", 20, null);
  const spain = event("es", "Spain", 40, null);
  assert.equal(calculateOverviewMetrics([portugal])?.totalFrpMw, 20);
  assert.equal(calculateOverviewMetrics([spain])?.projectedBurnAreaHectares, 16);
});
