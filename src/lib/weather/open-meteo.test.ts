import assert from "node:assert/strict";
import test from "node:test";
import { buildOpenMeteoUrl, parseOpenMeteoCurrent } from "./open-meteo";

const current = {
  time: "2026-10-02T13:00",
  temperature_2m: 24.5,
  relative_humidity_2m: 31,
  precipitation: 0,
  precipitation_probability: 5,
  wind_speed_10m: 18.2,
  wind_direction_10m: 290,
  wind_gusts_10m: 35.1,
};

test("parses current model values and marks their valid time as UTC", () => {
  assert.deepEqual(parseOpenMeteoCurrent({ current }), {
    temperatureC: 24.5,
    windSpeedKmh: 18.2,
    windDirectionDeg: 290,
    windGustKmh: 35.1,
    relativeHumidityPct: 31,
    precipitationMm: 0,
    precipitationProbabilityPct: 5,
    validAt: "2026-10-02T13:00:00.000Z",
    provider: "Open-Meteo",
  });
});

test("rejects incomplete or malformed responses instead of showing partial weather", () => {
  assert.equal(parseOpenMeteoCurrent(null), null);
  assert.equal(parseOpenMeteoCurrent({ error: true, reason: "limit" }), null);
  assert.equal(parseOpenMeteoCurrent({ current: { ...current, wind_gusts_10m: null } }), null);
  assert.equal(parseOpenMeteoCurrent({ current: { ...current, temperature_2m: "hot" } }), null);
  assert.equal(parseOpenMeteoCurrent({ current: { ...current, time: "later" } }), null);
});

test("sends only rounded detection coordinates and the variables shown", () => {
  const url = new URL(buildOpenMeteoUrl({ lat: 39.123456, lng: -8.987654 }));
  assert.equal(url.origin + url.pathname, "https://api.open-meteo.com/v1/forecast");
  assert.equal(url.searchParams.get("latitude"), "39.12");
  assert.equal(url.searchParams.get("longitude"), "-8.99");
  assert.equal(url.searchParams.get("timezone"), "GMT");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["current", "latitude", "longitude", "timezone", "wind_speed_unit"]);
});
