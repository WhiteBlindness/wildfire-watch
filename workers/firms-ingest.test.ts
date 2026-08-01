import assert from "node:assert/strict";
import test from "node:test";
import { selectPoints, type ParsedRow } from "./firms-ingest";

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
