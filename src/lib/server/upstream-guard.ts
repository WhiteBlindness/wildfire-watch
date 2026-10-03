/**
 * Small, deterministic protections for routes that call third-party APIs.
 *
 * Everything here is per Worker isolate and in memory: it costs nothing, needs
 * no binding, and never touches KV (whose free daily write quota is shared with
 * the scheduled ingest). It does not identify visitors; limits apply to how
 * often this isolate calls an upstream, not to who is asking.
 *
 *   - inputs are quantised, so trivially different requests share one result;
 *   - results are cached for a bounded time and number of entries;
 *   - identical concurrent lookups share one upstream call;
 *   - a fixed-window budget caps upstream calls per isolate, and the route
 *     answers 503 with Retry-After instead of amplifying a burst upstream.
 *
 * Isolates are created per Cloudflare location and recycled freely, so these
 * are best-effort ceilings, not exact global limits.
 */

type Clock = () => number;

/** Rounds to the nearest multiple of `step`, avoiding binary noise in the result. */
export function quantize(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

/** Rounds down to a multiple of `step` (used to grow a bounding box outward). */
export function floorTo(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return Number((Math.floor(value / step + 1e-9) * step).toFixed(decimals));
}

/** Rounds up to a multiple of `step`. */
export function ceilTo(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return Number((Math.ceil(value / step - 1e-9) * step).toFixed(decimals));
}

/** In-memory cache with a time-to-live and least-recently-used eviction. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: Clock = Date.now,
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Re-insert to mark as most recently used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

/** At most `limit` upstream calls per fixed window in this isolate. */
export class UpstreamBudget {
  private windowStart = 0;
  private used = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: Clock = Date.now,
  ) {}

  tryTake(): boolean {
    const now = this.now();
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used += 1;
    return true;
  }

  retryAfterSeconds(): number {
    return Math.max(1, Math.ceil((this.windowStart + this.windowMs - this.now()) / 1_000));
  }
}

export class UpstreamBusyError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Upstream budget exhausted");
    this.name = "UpstreamBusyError";
  }
}

export interface GuardedLookup<V> {
  cache: TtlCache<V>;
  budget: UpstreamBudget;
  inFlight: Map<string, Promise<V>>;
}

export function createGuardedLookup<V>(options: {
  maxEntries: number;
  ttlMs: number;
  budgetLimit: number;
  budgetWindowMs: number;
  now?: Clock;
}): GuardedLookup<V> {
  return {
    cache: new TtlCache<V>(options.maxEntries, options.ttlMs, options.now),
    budget: new UpstreamBudget(options.budgetLimit, options.budgetWindowMs, options.now),
    inFlight: new Map(),
  };
}

/**
 * Serves `key` from cache, joins an identical lookup already in flight, or
 * spends one unit of budget on `load`. Throws UpstreamBusyError when the budget
 * is spent. Failed loads are not cached.
 */
export async function guardedLookup<V>(
  guard: GuardedLookup<V>,
  key: string,
  load: () => Promise<V>,
  shouldCache: (value: V) => boolean = () => true,
): Promise<{ value: V; cached: boolean }> {
  const cached = guard.cache.get(key);
  if (cached !== undefined) return { value: cached, cached: true };

  const pending = guard.inFlight.get(key);
  if (pending) return { value: await pending, cached: true };

  if (!guard.budget.tryTake()) throw new UpstreamBusyError(guard.budget.retryAfterSeconds());

  const promise = load();
  guard.inFlight.set(key, promise);
  try {
    const value = await promise;
    if (shouldCache(value)) guard.cache.set(key, value);
    return { value, cached: false };
  } finally {
    guard.inFlight.delete(key);
  }
}

/** The response a route sends when its upstream budget is spent. */
export function upstreamBusyResponse(error: UpstreamBusyError, body: Record<string, unknown> = {}): Response {
  return Response.json(
    { error: "Temporarily busy, please retry shortly", ...body },
    { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": String(error.retryAfterSeconds) } },
  );
}

/**
 * fetch() options that also ask Cloudflare to cache the upstream response for
 * `ttlSeconds` (keyed by the upstream URL). Ignored outside Cloudflare.
 */
export function edgeCachedInit(init: RequestInit, ttlSeconds: number): RequestInit {
  const withCf: RequestInit & { cf?: { cacheTtl: number; cacheEverything: boolean } } = {
    ...init,
    cf: { cacheTtl: ttlSeconds, cacheEverything: true },
  };
  return withCf;
}

/** Name only: messages of fetch errors can contain upstream URLs and credentials. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}
