import assert from "node:assert/strict";
import test from "node:test";
import { GET, formatPlaceLabel } from "./route";

function request(query: string): Request {
  return new Request(`http://localhost/api/reverse-geocode?${query}`);
}

function withFetch(handler: (url: URL, init?: RequestInit) => Promise<Response>): { urls: URL[]; restore: () => void } {
  const original = globalThis.fetch;
  const urls: URL[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    urls.push(url);
    return handler(url, init);
  }) as typeof fetch;
  return { urls, restore: () => { globalThis.fetch = original; } };
}

test("formats municipality, region and country", () => {
  assert.equal(formatPlaceLabel({ town: "Arganil", state: "Coimbra", country: "Portugal" }), "Arganil/Coimbra, Portugal");
  assert.equal(formatPlaceLabel({ state: "Coimbra", country: "Portugal" }), "Coimbra, Portugal");
  assert.equal(formatPlaceLabel({ town: "Arganil" }), null);
});

test("rejects missing, blank and out-of-range coordinates", async () => {
  for (const query of ["lon=-8", "lat=&lon=-8", "lat=91&lon=0", "lat=0&lon=181", "lat=abc&lon=0"]) {
    assert.equal((await GET(request(query))).status, 400, query);
  }
});

test("nearby coordinates share one rounded Nominatim lookup", async () => {
  const { urls, restore } = withFetch(async () => Response.json({ address: { town: "Arganil", state: "Coimbra", country: "Portugal" } }));
  try {
    const first = await GET(request("lat=40.2183&lon=-8.0541&locale=pt"));
    const second = await GET(request("lat=40.2209&lon=-8.0559&locale=pt"));
    assert.deepEqual(await first.json(), { label: "Arganil/Coimbra, Portugal" });
    assert.deepEqual(await second.json(), { label: "Arganil/Coimbra, Portugal" });
    assert.equal(urls.length, 1, "the second request must be served from memory");
    assert.equal(urls[0].searchParams.get("lat"), "40.22");
    assert.equal(urls[0].searchParams.get("lon"), "-8.06");
    assert.equal(urls[0].searchParams.get("accept-language"), "pt-PT,pt,en");
  } finally {
    restore();
  }
});

test("identifies the application to Nominatim and never caches failures", async () => {
  let attempt = 0;
  const userAgents: Array<string | null> = [];
  const { restore } = withFetch(async (_url, init) => {
    userAgents.push(new Headers(init?.headers).get("user-agent"));
    attempt += 1;
    return attempt === 1 ? new Response("busy", { status: 429 }) : Response.json({ address: { country: "Spain" } });
  });
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
  try {
    const failed = await GET(request("lat=41.5&lon=-5.5&locale=en"));
    assert.equal(failed.status, 502);
    assert.equal(failed.headers.get("cache-control"), "no-store");
    const retried = await GET(request("lat=41.5&lon=-5.5&locale=en"));
    assert.deepEqual(await retried.json(), { label: "Spain" });
  } finally {
    restore();
    console.warn = originalWarn;
  }
  assert.match(userAgents[0] ?? "", /^WildfireWatch\/1\.0 \(\+https:\/\//);
  assert.deepEqual(warnings, ["Reverse geocoding failed (NominatimError 429)"]);
});
