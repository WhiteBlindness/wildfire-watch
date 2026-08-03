import { cachedPointToEvent, isFirmsCachePayload } from "./firms-cache";
import type { WildfireDataAdapter, WildfireEvent, WildfireFeedSnapshot } from "./types";

let cachedSnapshot: WildfireFeedSnapshot | null = null;

async function fetchCachedSnapshot(): Promise<WildfireFeedSnapshot> {
  if (cachedSnapshot) return cachedSnapshot;

  const response = await fetch("/api/fires", { cache: "no-store" });
  if (!response.ok) throw new Error(`Fire cache request failed: ${response.status}`);

  const payload: unknown = await response.json();
  if (!isFirmsCachePayload(payload)) throw new Error("Fire cache returned an invalid payload");

  cachedSnapshot = {
    events: payload.points.map((point) => cachedPointToEvent(point, payload.generatedAt)),
    sourceId: payload.source,
    sourceLabel: "NASA FIRMS Satellite Telemetry",
    generatedAt: payload.generatedAt,
  };
  return cachedSnapshot;
}

/** The app adapter reads only the Worker KV endpoint; NASA is never contacted
 * from the browser or from a page request. */
export const firmsAdapter: WildfireDataAdapter = {
  getSnapshot: fetchCachedSnapshot,
  async listEvents(): Promise<WildfireEvent[]> {
    return (await fetchCachedSnapshot()).events;
  },
  async getEvent(id: string): Promise<WildfireEvent | null> {
    const snapshot = await fetchCachedSnapshot();
    return snapshot.events.find((event) => event.id === id) ?? null;
  },
};
