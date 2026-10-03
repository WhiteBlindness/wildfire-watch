import { getCloudflareContext } from "@opennextjs/cloudflare";
import { FIRMS_CACHE_KEY, FIRMS_INGEST_HEALTH_KEY } from "@/lib/wildfire/firms-cache";
import { composeFiresResponseBody, readStoredIngestHealth } from "@/lib/wildfire/fires-response";

export const dynamic = "force-dynamic";

const UNAVAILABLE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(): Promise<Response> {
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

    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        "X-Wildfire-Source": "cloudflare-kv",
        // Lets a monitor check the pipeline without downloading the body.
        ...(health ? { "X-Wildfire-Ingest-Outcome": health.outcome } : {}),
      },
    });
  } catch (error) {
    console.error("Unable to read FIRMS_CACHE", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "Fire cache unavailable" }, { status: 503, headers: UNAVAILABLE_HEADERS });
  }
}
