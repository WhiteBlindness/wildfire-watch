import assert from "node:assert/strict";
import test from "node:test";
import { HECTARES_PER_MW_HOUR, estimateBurnedAreaHectares } from "./fire-estimation";

const NOW = Date.parse("2026-10-02T12:00:00.000Z");

test("the coefficient follows the documented combustion factor and fuel load", () => {
  const kgPerMwHour = 3_600 * 0.368;
  const hectares = kgPerMwHour / 3.8 / 10_000;
  assert.ok(Math.abs(hectares - HECTARES_PER_MW_HOUR) < 0.001);
});

test("scales with FRP and time since first detection", () => {
  assert.equal(estimateBurnedAreaHectares(100, "2026-10-02T02:00:00.000Z", NOW), 35);
  assert.equal(estimateBurnedAreaHectares(100, "2026-10-02T07:00:00.000Z", NOW), 18, "values from 10 ha are whole hectares");
});

test("stays bounded for implausible inputs", () => {
  assert.equal(estimateBurnedAreaHectares(10, "2026-10-02T12:00:00.000Z", NOW), 0.2, "elapsed time floors at 30 minutes");
  assert.equal(estimateBurnedAreaHectares(10, "2026-09-01T00:00:00.000Z", NOW), 25, "elapsed time caps at 72 hours");
  assert.equal(estimateBurnedAreaHectares(1e9, "2026-09-01T00:00:00.000Z", NOW), 50_000);
  assert.equal(estimateBurnedAreaHectares(Number.NaN, "not a date", NOW), 0.1);
});
