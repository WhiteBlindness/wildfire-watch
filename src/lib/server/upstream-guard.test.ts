import assert from "node:assert/strict";
import test from "node:test";
import {
  TtlCache,
  UpstreamBudget,
  UpstreamBusyError,
  ceilTo,
  createGuardedLookup,
  floorTo,
  guardedLookup,
  quantize,
  upstreamBusyResponse,
} from "./upstream-guard";

test("quantisation collapses nearby inputs onto one key", () => {
  assert.equal(quantize(38.71234, 0.02), 38.72);
  assert.equal(quantize(38.7101, 0.02), 38.72);
  assert.equal(quantize(38.7099, 0.02), 38.7);
  assert.equal(quantize(-9.1393, 0.02), -9.14);
  assert.equal(floorTo(-9.13, 0.1), -9.2);
  assert.equal(ceilTo(-9.13, 0.1), -9.1);
  assert.equal(floorTo(38.7, 0.1), 38.7, "exact multiples stay put");
  assert.equal(ceilTo(38.7, 0.1), 38.7);
});

test("the cache expires entries and evicts the least recently used", () => {
  let now = 0;
  const cache = new TtlCache<string>(2, 1_000, () => now);
  cache.set("a", "A");
  cache.set("b", "B");
  assert.equal(cache.get("a"), "A");
  cache.set("c", "C");
  assert.equal(cache.get("b"), undefined, "b was least recently used");
  assert.equal(cache.get("a"), "A");
  now = 1_000;
  assert.equal(cache.get("a"), undefined, "expired");
});

test("the budget allows a fixed number of calls per window", () => {
  let now = 0;
  const budget = new UpstreamBudget(2, 60_000, () => now);
  assert.equal(budget.tryTake(), true);
  assert.equal(budget.tryTake(), true);
  assert.equal(budget.tryTake(), false);
  now = 45_000;
  assert.equal(budget.retryAfterSeconds(), 15);
  now = 60_000;
  assert.equal(budget.tryTake(), true);
});

test("identical concurrent lookups share one upstream call and later ones hit the cache", async () => {
  const guard = createGuardedLookup<number>({ maxEntries: 10, ttlMs: 60_000, budgetLimit: 5, budgetWindowMs: 60_000 });
  let calls = 0;
  const load = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return 42; };
  const results = await Promise.all([guardedLookup(guard, "k", load), guardedLookup(guard, "k", load)]);
  assert.deepEqual(results.map((result) => result.value), [42, 42]);
  assert.equal(calls, 1);
  assert.deepEqual(await guardedLookup(guard, "k", load), { value: 42, cached: true });
  assert.equal(calls, 1);
});

test("a spent budget refuses new upstream calls but still serves cached results", async () => {
  const guard = createGuardedLookup<string>({ maxEntries: 10, ttlMs: 60_000, budgetLimit: 1, budgetWindowMs: 60_000 });
  await guardedLookup(guard, "first", async () => "ok");
  await assert.rejects(guardedLookup(guard, "second", async () => "never"), UpstreamBusyError);
  assert.equal((await guardedLookup(guard, "first", async () => "never")).value, "ok");

  const response = upstreamBusyResponse(new UpstreamBusyError(30));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("failed loads and unwanted values are not cached", async () => {
  const guard = createGuardedLookup<string | null>({ maxEntries: 10, ttlMs: 60_000, budgetLimit: 10, budgetWindowMs: 60_000 });
  await assert.rejects(guardedLookup(guard, "k", async () => { throw new Error("down"); }));
  assert.equal(guard.cache.size, 0);
  await guardedLookup(guard, "k", async () => null, (value) => value !== null);
  assert.equal(guard.cache.size, 0);
  assert.equal(guard.inFlight.size, 0);
});
