import assert from "node:assert/strict";
import test from "node:test";
import { buildFirmsWorldUrl, selectPoints, toTimestamp, type ParsedRow } from "./firms-ingest";
import {
  FIRMS_MIN_GLOBAL_POINTS,
  isGlobalFirmsCachePayload,
  type CachedFirmsPoint,
  type FirmsCachePayload,
} from "../src/lib/wildfire/firms-cache";

const BASE_TIME = Date.parse("2026-08-01T00:00:00Z");

function row(index: number, lat: number, lng: number, frpMw: number): ParsedRow {
  return {
    lat,
    lng,
    frpMw,
    confidencePct: 90,
    detectedAt: new Date(BASE_TIME + index * 1_000).toISOString(),
  };
}

test("hybrid sampling retains the top 1,500 threats and fills spatial cells evenly", () => {
  const rows: ParsedRow[] = [];

  // Simulate a very dense high-intensity region. Every one of the absolute
  // top 1,500 points must survive even though they occupy one grid cell.
  for (let index = 0; index < 2_000; index += 1) {
    rows.push(row(index, -10.2, -60.4, 10_000 - index));
  }

  // Add seven rounds of lower-FRP detections across 1,000 global cells.
  for (let index = 0; index < 7_000; index += 1) {
    const cell = index % 1_000;
    const lat = -70 + (cell % 50) * 2.2;
    const lng = -160 + Math.floor(cell / 50) * 8;
    rows.push(row(2_000 + index, lat, lng, 1_000 - (index % 1_000) / 10));
  }

  // Low-FRP Turkish anomalies must still survive through spatial coverage.
  rows.push(row(9_001, 39.1, 35.2, 4.2));
  rows.push(row(9_002, 37.0, 37.4, 3.8));
  rows.push(row(9_003, 38.5, 27.2, 3.4));

  const selected = selectPoints(rows);
  const repeated = selectPoints([...rows].reverse());

  assert.equal(selected.length, 6_000);
  assert.equal(selected[0].frpMw, 10_000);
  assert.equal(selected[1_499].frpMw, 8_501);
  assert.ok(selected.slice(0, 1_500).every((point, index) => point.frpMw === 10_000 - index));
  assert.ok(selected.some((point) => point.lat >= 35.7 && point.lat <= 42.2 && point.lng >= 25.5 && point.lng <= 45));
  assert.deepEqual(repeated.map((point) => point.id), selected.map((point) => point.id));
});

test("world ingestion omits a local date and never narrows the FIRMS area", () => {
  const url = buildFirmsWorldUrl("key/with spaces");
  assert.equal(
    url,
    "https://firms.modaps.eosdis.nasa.gov/api/area/csv/key%2Fwith%20spaces/VIIRS_SNPP_NRT/world/3",
  );
  assert.ok(!url.includes(","));
  assert.ok(!url.match(/\/\d{4}-\d{2}-\d{2}(?:\/|$)/));
});

test("global cache validation rejects a fixture-sized regional snapshot", () => {
  const points = Array.from({ length: FIRMS_MIN_GLOBAL_POINTS }, (_, index): CachedFirmsPoint => ({
    id: `point-${index}`,
    lat: -75 + ((index % 5) * 30),
    lng: -165 + ((index % 12) * 30),
    frpMw: 10 + (index % 100),
    confidencePct: 80,
    detectedAt: "2026-08-01T12:34:00.000Z",
  }));
  const payload: FirmsCachePayload = {
    version: 1,
    source: "NASA FIRMS VIIRS_SNPP_NRT",
    generatedAt: "2026-08-01T13:00:00.000Z",
    sourceRows: 10_000,
    filteredRows: 9_000,
    points,
  };

  assert.equal(isGlobalFirmsCachePayload(payload), true);
  assert.equal(isGlobalFirmsCachePayload({ ...payload, points: points.slice(0, 8) }), false);
});

test("FIRMS timestamps reject impossible or future UTC values", () => {
  assert.equal(toTimestamp("2026-02-30", "1200"), null);
  assert.equal(toTimestamp("2026-08-01", "2360"), null);
  assert.equal(toTimestamp("2099-01-01", "0000"), null);
  assert.equal(toTimestamp("2026-08-01", "1234"), "2026-08-01T12:34:00.000Z");
});
