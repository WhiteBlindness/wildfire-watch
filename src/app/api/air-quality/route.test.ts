import assert from "node:assert/strict";
import test from "node:test";
import { GET, distanceBetweenKm, pm25ToAqi } from "./route";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.OPENAQ_API_KEY;

function jsonResponse(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}

function request(lat: number, lon: number): Request {
  return new Request(`http://localhost/api/air-quality?lat=${lat}&lon=${lon}`);
}

test("OpenAQ air-quality route", async (suite) => {
  process.env.OPENAQ_API_KEY = "test-key";

  await suite.test("uses the supported v3 API and expands the station search to 100 km", async () => {
    const requestedUrls: URL[] = [];
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      requestedUrls.push(url);

      if (url.pathname === "/v3/locations" && url.searchParams.has("coordinates")) {
        assert.equal(url.searchParams.get("radius"), "25000");
        return jsonResponse({
          results: [{
            id: 7,
            name: "Nearby monitor without a current value",
            coordinates: { latitude: 34.05, longitude: -118.2 },
            sensors: [{ id: 111, parameter: { id: 2, name: "pm25", units: "µg/m³" } }],
          }],
        });
      }
      if (url.pathname === "/v3/locations" && url.searchParams.has("bbox")) {
        return jsonResponse({
          results: [{
            id: 44,
            name: "Regional PM2.5 monitor",
            coordinates: { latitude: 34.05, longitude: -117.7 },
            sensors: [{ id: 222, parameter: { id: 2, name: "pm25", units: "µg/m³" } }],
          }],
        });
      }
      if (url.pathname === "/v3/locations/44/latest") {
        return jsonResponse({
          results: [{
            value: 55,
            datetime: { utc: "2026-08-03T08:00:00Z" },
            sensorsId: 222,
          }],
        });
      }
      if (url.pathname === "/v3/locations/7/latest") return jsonResponse({ results: [] });
      return jsonResponse({ error: "Unexpected request" }, 500);
    }) as typeof fetch;

    const response = await GET(request(34.05, -118.25));
    const payload = await response.json() as {
      reading: { pm25: number; stationName: string; distanceKm: number } | null;
      availability: string;
      searchRadiusKm: number;
    };

    assert.equal(response.status, 200);
    assert.equal(payload.availability, "available");
    assert.equal(payload.searchRadiusKm, 100);
    assert.equal(payload.reading?.pm25, 55);
    assert.equal(payload.reading?.stationName, "Regional PM2.5 monitor");
    assert.ok((payload.reading?.distanceKm ?? 0) > 25);
    assert.ok(requestedUrls.every((url) => url.pathname.startsWith("/v3/")));
    assert.ok(requestedUrls.some((url) => url.searchParams.has("bbox")));
  });

  await suite.test("returns an explicit no-monitor result for remote coordinates", async () => {
    globalThis.fetch = (async () => jsonResponse({ results: [] })) as typeof fetch;

    const response = await GET(request(65, 100));
    const payload = await response.json() as { reading: null; availability: string; searchRadiusKm: number };

    assert.equal(response.status, 200);
    assert.equal(payload.reading, null);
    assert.equal(payload.availability, "no-nearby-monitor");
    assert.equal(payload.searchRadiusKm, 100);
  });

  await suite.test("maps upstream failures to a non-cacheable error response", async () => {
    globalThis.fetch = (async () => jsonResponse({ error: "upstream failure" }, 500)) as typeof fetch;

    const response = await GET(request(38.72, -9.14));
    const payload = await response.json() as { availability: string };

    assert.equal(response.status, 502);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(payload.availability, "upstream-error");
  });

  await suite.test("rejects invalid coordinates before contacting OpenAQ", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return jsonResponse({});
    }) as typeof fetch;

    const response = await GET(request(120, -9.14));

    assert.equal(response.status, 400);
    assert.equal(fetchCalled, false);
  });

  await suite.test("nearby detections share one OpenAQ search but keep their own distance", async () => {
    let calls = 0;
    globalThis.fetch = (async (input) => {
      calls += 1;
      const url = new URL(String(input));
      if (url.pathname === "/v3/locations") {
        return jsonResponse({
          results: [{
            id: 90,
            name: "Coimbra monitor",
            coordinates: { latitude: 40.2, longitude: -8.42 },
            sensors: [{ id: 900, parameter: { id: 2, name: "pm25", units: "µg/m³" } }],
          }],
        });
      }
      return jsonResponse({ results: [{ value: 8, datetime: { utc: "2026-08-03T08:00:00Z" }, sensorsId: 900 }] });
    }) as typeof fetch;

    const first = await (await GET(request(40.211, -8.401))).json() as { reading: { distanceKm: number } };
    const callsAfterFirst = calls;
    const second = await (await GET(request(40.2149, -8.4049))).json() as { reading: { distanceKm: number } };

    assert.equal(calls, callsAfterFirst, "the second lookup must be served from memory");
    assert.equal(first.reading.distanceKm, Math.round(distanceBetweenKm(40.211, -8.401, 40.2, -8.42) * 10) / 10);
    assert.equal(second.reading.distanceKm, Math.round(distanceBetweenKm(40.2149, -8.4049, 40.2, -8.42) * 10) / 10);
  });

  await suite.test("a spent lookup budget answers 503 without calling OpenAQ", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse({ results: [] });
    }) as typeof fetch;

    const statuses: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      const response = await GET(request(-30 + index, 20));
      statuses.push(response.status);
    }
    const busy = statuses.filter((status) => status === 503).length;
    assert.ok(busy >= 2, `expected the per-isolate budget to refuse some lookups, got ${statuses.join(",")}`);
    const callsBefore = calls;
    const refused = await GET(request(-10, 20));
    assert.equal(refused.status, 503);
    assert.ok(Number(refused.headers.get("retry-after")) >= 1);
    assert.equal(calls, callsBefore);
  });

  assert.equal(pm25ToAqi(12).aqi, 50);
  assert.equal(pm25ToAqi(35.4).aqi, 100);
  assert.ok(distanceBetweenKm(34.05, -118.25, 34.05, -117.7) > 25);
});

test.after(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.OPENAQ_API_KEY;
  else process.env.OPENAQ_API_KEY = originalApiKey;
});
