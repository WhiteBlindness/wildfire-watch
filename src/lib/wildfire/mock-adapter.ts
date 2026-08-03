import "server-only";

import { generateMockEvents } from "./mock-generator";
import type { WildfireDataAdapter, WildfireEvent, WildfireFeedSnapshot } from "./types";

let cachedSnapshot: WildfireFeedSnapshot | null = null;

function getMockSnapshot(): WildfireFeedSnapshot {
  if (cachedSnapshot) return cachedSnapshot;
  const events = generateMockEvents();
  cachedSnapshot = {
    events,
    sourceId: "deterministic-mock",
    sourceLabel: "Deterministic demonstration data",
    generatedAt: events[0]?.lastUpdated ?? null,
  };
  return cachedSnapshot;
}

/** Reference adapter backed by the deterministic mock generator. Real adapters
 * (NASA FIRMS, EFFIS, local civil protection) implement the same
 * WildfireDataAdapter interface and can be swapped in via getWildfireAdapter()
 * without touching any UI component. */
export const mockAdapter: WildfireDataAdapter = {
  async getSnapshot(): Promise<WildfireFeedSnapshot> {
    return getMockSnapshot();
  },
  async listEvents(): Promise<WildfireEvent[]> {
    return getMockSnapshot().events;
  },
  async getEvent(id: string): Promise<WildfireEvent | null> {
    return getMockSnapshot().events.find((event) => event.id === id) ?? null;
  },
};
