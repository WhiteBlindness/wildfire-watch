import "server-only";

import { generateMockEvents } from "./mock-generator";
import type { WildfireDataAdapter, WildfireEvent } from "./types";

/** Reference adapter backed by the deterministic mock generator. Real adapters
 * (NASA FIRMS, EFFIS, local civil protection) implement the same
 * WildfireDataAdapter interface and can be swapped in via getWildfireAdapter()
 * without touching any UI component. */
export const mockAdapter: WildfireDataAdapter = {
  async listEvents(): Promise<WildfireEvent[]> {
    return generateMockEvents();
  },
  async getEvent(id: string): Promise<WildfireEvent | null> {
    return generateMockEvents().find((event) => event.id === id) ?? null;
  },
};
