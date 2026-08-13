import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  FIRMS_CACHE_KEY,
  FIRMS_INGEST_HEALTH_KEY,
  isGlobalFirmsCachePayload,
  type IngestHealth,
} from "@/lib/wildfire/firms-cache";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const cached = await env.FIRMS_CACHE.get(FIRMS_CACHE_KEY);

    if (!cached) {
      return Response.json(
        { error: "FIRMS cache has not been populated yet" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(cached);
    } catch {
      return Response.json(
        { error: "FIRMS cache contains invalid JSON" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (!isGlobalFirmsCachePayload(payload)) {
      return Response.json(
        { error: "FIRMS cache does not contain a complete worldwide snapshot" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Read ingest health separately — never let a missing/corrupt health
    // record degrade the main snapshot response.
    let health: IngestHealth | null = null;
    try {
      const rawHealth = await env.FIRMS_CACHE.get(FIRMS_INGEST_HEALTH_KEY);
      if (rawHealth) {
        const parsed = JSON.parse(rawHealth) as unknown;
        if (
          parsed
          && typeof parsed === "object"
          && "outcome" in parsed
          && "attemptedAt" in parsed
        ) {
          health = parsed as IngestHealth;
        }
      }
    } catch {
      // Health is optional metadata — swallow errors so the snapshot still serves.
    }

    // Inject the health record into the response as an additive top-level field.
    // Existing consumers that only read version/source/generatedAt/sourceRows/
    // filteredRows/points are unaffected (new field is ignored by unknown-field-
    // tolerant parsers, which all reasonable JSON consumers are).
    //
    // The `ingestHealth` field lets clients distinguish:
    //   outcome:"success" + old generatedAt → feed is fine, just stale
    //   outcome:"failure"                   → refreshes are failing right now
    //   null                                → health key not yet populated
    const responseBody = health !== null
      ? JSON.stringify({ ...payload, ingestHealth: health })
      : cached;

    return new Response(responseBody, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
        "X-Wildfire-Source": "cloudflare-kv",
        "X-Wildfire-Point-Count": String(payload.points.length),
        // Surface health outcome as a header too so lightweight monitors can
        // check ingest status without parsing the full JSON body.
        ...(health ? { "X-Wildfire-Ingest-Outcome": health.outcome } : {}),
      },
    });
  } catch (error) {
    console.error("Unable to read FIRMS_CACHE", error);
    return Response.json({ error: "Fire cache unavailable" }, { status: 503 });
  }
}
