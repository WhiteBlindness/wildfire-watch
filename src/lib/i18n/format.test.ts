import assert from "node:assert/strict";
import test from "node:test";
import { formatCompactDecimal, formatDateTime, formatDecimal, formatUtcDateTime } from "./format";

test("decimals use the locale's mark and a non-breaking thousands space", () => {
  assert.equal(formatDecimal(12.34, "pt"), "12,3");
  assert.equal(formatDecimal(12.34, "en"), "12.3");
  assert.equal(formatDecimal(1234.56, "pt"), "1 234,6");
  assert.equal(formatDecimal(-0.04, "pt"), "0,0");
  assert.equal(formatDecimal(-2.5, "en"), "-2.5");
  assert.equal(formatDecimal(Number.NaN, "pt"), "—");
});

test("compact decimals keep one place only below ten", () => {
  assert.equal(formatCompactDecimal(3.25, "pt"), "3,3");
  assert.equal(formatCompactDecimal(4, "pt"), "4");
  assert.equal(formatCompactDecimal(1520.4, "pt"), "1 520");
});

test("dates read day first and UTC times ignore the visitor's zone", () => {
  assert.match(formatUtcDateTime("2026-10-02T03:07:00.000Z", "pt"), /^02\/10\/2026,? 03:07$/);
  assert.match(formatUtcDateTime("2026-10-02T03:07:00.000Z", "en"), /^02\/10\/2026,? 03:07$/);
  assert.match(formatDateTime("2026-10-02T03:07:00.000Z", "pt"), /^\d{2}\/\d{2}\/2026,? \d{2}:\d{2}$/);
  assert.equal(formatUtcDateTime("not a date", "pt"), "—");
});
