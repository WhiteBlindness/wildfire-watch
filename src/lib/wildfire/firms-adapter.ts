import { cachedPointToEvent, isFirmsCachePayload } from "./firms-cache";
import type { WildfireDataAdapter, WildfireEvent } from "./types";

let cachedEvents: WildfireEvent[] | null = null;

async function fetchCachedEvents(): Promise<WildfireEvent[]> {
  if (cachedEvents) return cachedEvents;

  const response = await fetch("/api/fires", { cache: "no-store" });
  if (!response.ok) throw new Error(`Fire cache request failed: ${response.status}`);

  const payload: unknown = await response.json();
  if (!isFirmsCachePayload(payload)) throw new Error("Fire cache returned an invalid payload");

  cachedEvents = payload.points.map((point) => cachedPointToEvent(point, payload.generatedAt));
  return cachedEvents;
}

/** The app adapter reads only the Worker KV endpoint; NASA is never contacted
 * from the browser or from a page request. */
export const firmsAdapter: WildfireDataAdapter = {
  listEvents: fetchCachedEvents,
  async getEvent(id: string): Promise<WildfireEvent | null> {
    const events = await fetchCachedEvents();
    return events.find((event) => event.id === id) ?? null;
  },
};
