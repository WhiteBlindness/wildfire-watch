import "server-only";

import { mockAdapter } from "./mock-adapter";
import { firmsAdapter } from "./firms-adapter";
import type { WildfireDataAdapter } from "./types";

export * from "./types";
export { generateMockEvents } from "./mock-generator";

/** Single seam to swap data sources: every consumer (map, panel, charts) only
 * ever talks to the WildfireDataAdapter interface, never to a concrete provider.
 *
 * DATA_SOURCE env var selects the source:
 *  - "firms": NASA FIRMS satellite hotspots (needs FIRMS_MAP_KEY)
 *  - "mock":  deterministic synthetic generator
 *  - unset:   firms when FIRMS_MAP_KEY is present, mock otherwise
 */
export function getWildfireAdapter(): WildfireDataAdapter {
  const requested = process.env.DATA_SOURCE?.trim().toLowerCase();
  const hasFirmsKey = Boolean(process.env.FIRMS_MAP_KEY);

  if (requested === "mock") return mockAdapter;
  if (requested === "firms") {
    if (!hasFirmsKey) {
      console.warn("[wildfire] DATA_SOURCE=firms but FIRMS_MAP_KEY is missing — falling back to mock data.");
      return mockAdapter;
    }
    return firmsAdapter;
  }

  // No explicit choice: prefer real data when a key is available.
  return hasFirmsKey ? firmsAdapter : mockAdapter;
}
