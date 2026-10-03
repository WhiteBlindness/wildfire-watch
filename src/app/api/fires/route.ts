import { getCloudflareContext } from "@opennextjs/cloudflare";
import { FIRMS_CACHE_KEY, FIRMS_INGEST_HEALTH_KEY } from "@/lib/wildfire/firms-cache";
import { composeFiresResponseBody, readStoredIngestHealth } from "@/lib/wildfire/fires-response";
import { TtlCache, errorName } from "@/lib/server/upstream-guard";

export const dynamic = "force-dynamic";

const UNAVAILABLE_HEADERS = { "Cache-Control": "no-store" };

/**
 * The snapshot changes once an hour, but every page load asks for it. Keeping
 * the composed body in memory for a minute bounds KV reads to about two per
 * minute per isolate, so a burst of requests cannot spend the free plan's
 * daily read quota that the map depends on.
 */
const SNAPSHOT_MEMORY_MS = 60_000;
const responses = new TtlCache<{ body: string; outcome: string | null }>(1, SNAPSHOT_MEMORY_MS);

function snapshotResponse(body: string, outcome: string | null, source: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      "X-Wildfire-Source": source,
      // Lets a monitor check the pipeline without downloading the body.
      ...(outcome ? { "X-Wildfire-Ingest-Outcome": outcome } : {}),
    },
  });
}

export async function GET(): Promise<Response> {
  const remembered = responses.get("snapshot");
  if (remembered) return snapshotResponse(remembered.body, remembered.outcome, "memory");

  try {
    const { env } = await getCloudflareContext({ async: true });
    const [snapshot, rawHealth] = await Promise.all([
      env.FIRMS_CACHE.get(FIRMS_CACHE_KEY),
      // Health is optional metadata: a missing or corrupt record must never
      // stop the snapshot from being served.
      env.FIRMS_CACHE.get(FIRMS_INGEST_HEALTH_KEY).catch(() => null),
    ]);

    if (!snapshot) {
      return Response.json({ error: "FIRMS cache has not been populated yet" }, { status: 503, headers: UNAVAILABLE_HEADERS });
    }

    const health = readStoredIngestHealth(rawHealth);
    const body = composeFiresResponseBody(snapshot, health);
    if (!body) {
      return Response.json({ error: "FIRMS cache does not contain a snapshot" }, { status: 503, headers: UNAVAILABLE_HEADERS });
    }

    const outcome = health?.outcome ?? null;
    responses.set("snapshot", { body, outcome });
    return snapshotResponse(body, outcome, "cloudflare-kv");
  } catch (error) {
    console.error("Unable to read FIRMS_CACHE", errorName(error));
    return Response.json({ error: "Fire cache unavailable" }, { status: 503, headers: UNAVAILABLE_HEADERS });
  }
}
