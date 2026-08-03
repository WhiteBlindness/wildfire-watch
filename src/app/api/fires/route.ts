import { getCloudflareContext } from "@opennextjs/cloudflare";
import { FIRMS_CACHE_KEY, isGlobalFirmsCachePayload } from "@/lib/wildfire/firms-cache";

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

    return new Response(cached, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
        "X-Wildfire-Source": "cloudflare-kv",
        "X-Wildfire-Point-Count": String(payload.points.length),
      },
    });
  } catch (error) {
    console.error("Unable to read FIRMS_CACHE", error);
    return Response.json({ error: "Fire cache unavailable" }, { status: 503 });
  }
}
