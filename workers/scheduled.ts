import { refreshFirmsCache, type FirmsIngestEnv, type IngestRunReport } from "./firms-ingest";
import { refreshOperationalIncidents, type AnepcRunReport, type FusionInput } from "./anepc-ingest";
import { FIRMS_INGEST_HEALTH_KEY, type FirmsCachePayload } from "../src/lib/wildfire/firms-cache";
import { INCIDENTS_INGEST_HEALTH_KEY, buildFusionIndex, readFusionIndex } from "../src/lib/operational/incidents-cache";
import { parseIngestHealth, type IngestHealthRecord } from "../src/lib/wildfire/ingest-health";
import { deliverText, type AlertChannel } from "../src/lib/monitoring/alert-channels";
import { emptySignals, formatDigestText, isDigestDue, planDigest } from "../src/lib/monitoring/daily-digest";

/**
 * What each cron trigger does. Free-plan budget (per day, account-wide KV
 * limit 1,000 writes): the hourly run writes 4 FIRMS keys and 2 ANEPC keys,
 * the three quarter-hour runs 2 ANEPC keys each, and the daily summary at
 * most 3 more: about 290 writes a day.
 */
export const FIRMS_CRON = "0 * * * *";
export const OPERATIONAL_CRON = "15,30,45 * * * *";
export const DIGEST_STATE_KEY = "operations:digest:v1";

export type ScheduledEnv = FirmsIngestEnv;

export interface ScheduledOptions {
  now?: () => number;
  channels: AlertChannel[];
}

export interface ScheduledSummary {
  firms: IngestRunReport | null;
  anepc: AnepcRunReport | null;
  digestSent: boolean;
}

/** Each source runs in isolation: an unexpected crash in one is logged by name and the other still runs. */
async function isolated<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    console.error(`${label} scheduled run crashed`, error instanceof Error ? error.name : "unknown");
    return null;
  }
}

function fusionFrom(payload: FirmsCachePayload | null | undefined): FusionInput | undefined {
  if (!payload) return undefined; // fall back to the stored index
  return readFusionIndex(buildFusionIndex(payload.points, payload.generatedAt)) ?? undefined;
}

async function readHealth(env: ScheduledEnv, key: string): Promise<IngestHealthRecord | null> {
  try {
    return parseIngestHealth(await env.FIRMS_CACHE.get(key, "json"));
  } catch {
    return null;
  }
}

/** Starts a new signal window in a stored health record, if there is one. */
async function resetSignals(env: ScheduledEnv, key: string, record: IngestHealthRecord | null, now: number): Promise<void> {
  if (!record) return;
  await env.FIRMS_CACHE.put(key, JSON.stringify({ ...record, signals: emptySignals(new Date(now).toISOString()) })).catch(() => undefined);
}

/**
 * At most once a day: the day is recorded before anything is sent, and if
 * that record cannot be read or written (for example when the daily KV write
 * limit is reached) nothing is sent. A summary can be lost, never repeated.
 */
async function runDigest(env: ScheduledEnv, channels: AlertChannel[], now: number): Promise<boolean> {
  let lastPlannedAt: string | null;
  try {
    const state = await env.FIRMS_CACHE.get<{ lastPlannedAt?: unknown }>(DIGEST_STATE_KEY, "json");
    lastPlannedAt = typeof state?.lastPlannedAt === "string" ? state.lastPlannedAt : null;
  } catch {
    return false;
  }
  if (!isDigestDue(lastPlannedAt, now)) return false;

  const [firms, anepc] = await Promise.all([readHealth(env, FIRMS_INGEST_HEALTH_KEY), readHealth(env, INCIDENTS_INGEST_HEALTH_KEY)]);
  const plan = planDigest([{ source: "firms", signals: firms?.signals }, { source: "anepc", signals: anepc?.signals }]);
  try {
    await env.FIRMS_CACHE.put(DIGEST_STATE_KEY, JSON.stringify({ version: 1, lastPlannedAt: new Date(now).toISOString() }));
  } catch {
    return false;
  }
  if (plan) await deliverText(formatDigestText(plan, now), channels);
  await resetSignals(env, FIRMS_INGEST_HEALTH_KEY, firms, now);
  await resetSignals(env, INCIDENTS_INGEST_HEALTH_KEY, anepc, now);
  return plan !== null;
}

export async function runScheduled(cron: string, env: ScheduledEnv, options: ScheduledOptions): Promise<ScheduledSummary> {
  const now = options.now ?? Date.now;
  const { channels } = options;

  if (cron !== FIRMS_CRON) {
    const anepc = await isolated("ANEPC", () => refreshOperationalIncidents(env, { now, channels }));
    return { firms: null, anepc, digestSent: false };
  }

  const firms = await isolated("FIRMS", () => refreshFirmsCache(env, { now, channels }));
  const anepc = await isolated("ANEPC", () => refreshOperationalIncidents(env, { now, channels, fusion: fusionFrom(firms?.payload) }));
  const digestSent = (await isolated("Daily summary", () => runDigest(env, channels, now()))) ?? false;
  return { firms, anepc, digestSent };
}
