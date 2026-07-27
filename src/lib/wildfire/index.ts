import "server-only";

import { mockAdapter } from "./mock-adapter";
import type { WildfireDataAdapter } from "./types";

export * from "./types";
export { generateMockEvents } from "./mock-generator";

/** Single seam to swap the mock generator for a real API adapter later:
 * change this one export and every consumer (map, panel, charts) keeps working. */
export function getWildfireAdapter(): WildfireDataAdapter {
  return mockAdapter;
}
