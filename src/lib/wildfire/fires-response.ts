import { parseIngestHealth, toPublicIngestHealth, type PublicIngestHealth } from "./ingest-health";

/**
 * Every snapshot the ingest writes starts with this exact prefix, because it is
 * produced by JSON.stringify of a FirmsCachePayload whose first key is version.
 */
const SNAPSHOT_PREFIX = '{"version":1,';

/**
 * Builds the /api/fires body from the stored snapshot string without parsing
 * it. The snapshot is about 1.8 MB of JSON; a parse plus re-serialise on every
 * request would spend most of the Workers Free plan's 10 ms CPU budget. The
 * scheduled ingest validates the payload before it is written, and the browser
 * validates it again before use, so the route only checks the envelope.
 *
 * Returns null when the stored value does not look like a snapshot at all.
 */
export function composeFiresResponseBody(snapshot: string, health: PublicIngestHealth | null): string | null {
  if (!snapshot.startsWith(SNAPSHOT_PREFIX) || !snapshot.endsWith("}")) return null;
  if (!health) return snapshot;
  return `${snapshot.slice(0, -1)},"ingestHealth":${JSON.stringify(health)}}`;
}

/** Reads the stored health record; anything malformed is treated as unknown, never as an error. */
export function readStoredIngestHealth(raw: string | null): PublicIngestHealth | null {
  if (!raw) return null;
  try {
    const record = parseIngestHealth(JSON.parse(raw));
    return record ? toPublicIngestHealth(record) : null;
  } catch {
    return null;
  }
}
