import { haversineKm } from "@/lib/geo/distance";
import type { GeoPoint, OperationalIncident } from "@/lib/wildfire/types";

/**
 * Deterministic reconciliation of satellite thermal detections with official
 * operational incidents. Every decision follows the fixed rules below, uses
 * only distance, time and identifiers, and is published with its evidence,
 * so anyone can reproduce it from the two inputs. Nothing is merged: both
 * sources keep their own records, and the result only links them.
 *
 *   1. A detection is a candidate for an incident when it lies within
 *      MATCH_RADIUS_KM of the incident's registered location and was acquired
 *      no earlier than PRE_REPORT_WINDOW before the incident started.
 *   2. One candidate: the detection is linked to it.
 *   3. Several candidates: the detection is linked to the nearest one only if
 *      every other candidate is more than AMBIGUITY_MARGIN_KM farther away.
 *      Otherwise it is ambiguous and linked to none; the close candidates are
 *      listed so the interface can say so.
 *   4. An incident's satellite evidence is "recent" when a linked detection
 *      is no older than RECENT_DETECTION, "earlier" when all are older, and
 *      "none" without any.
 *
 * Why these values: the incident location is where the occurrence was
 * registered, often the nearest locality rather than the fire front, and a
 * spreading fire covers several kilometres; VIIRS pixels are about 375 m.
 * Heat can be seen shortly before an occurrence is registered, but a
 * detection many hours older belongs to an earlier event.
 */
export const MATCH_RULES = {
  matchRadiusKm: 5,
  ambiguityMarginKm: 1,
  preReportWindowHours: 6,
  recentDetectionHours: 12,
} as const;

/** The interface notes a location disagreement when the nearest linked detection is farther than this. */
export const LOCATION_NOTE_KM = 2;

const HOUR_MS = 3_600_000;

/** The parts of a thermal detection the rules use. */
export interface FusionObservation {
  id: string;
  location: GeoPoint;
  acquiredAt: string;
  frpMw: number;
}

export interface DetectionMatch {
  detectionId: string;
  /** "matched": linked to one incident. "ambiguous": two or more incidents are about as close. */
  status: "matched" | "ambiguous";
  /** The linked incident, or the ambiguous candidates nearest first. */
  incidentIds: string[];
  /** Distance to the nearest candidate, in km, to one decimal. */
  distanceKm: number;
}

export type SatelliteEvidence = "recent" | "earlier" | "none";

export interface IncidentEvidence {
  incidentId: string;
  /** Linked detections, newest first. */
  matchedDetectionIds: string[];
  /** Detections close to this incident that could equally belong to another. */
  ambiguousDetectionIds: string[];
  nearestDetectionKm: number | null;
  latestDetectionAt: string | null;
  maxFrpMw: number | null;
  satellite: SatelliteEvidence;
}

export interface ReconciliationResult {
  rules: typeof MATCH_RULES;
  /** One entry per incident, ordered by incident id. */
  incidents: IncidentEvidence[];
  /** Only detections with at least one candidate, ordered by detection id. */
  detections: DetectionMatch[];
}

interface Candidate {
  incident: OperationalIncident;
  distanceKm: number;
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function roundKm(km: number): number {
  return Math.round(km * 10) / 10;
}

function candidatesFor(observation: FusionObservation, incidents: OperationalIncident[]): Candidate[] {
  const acquiredMs = Date.parse(observation.acquiredAt);
  const candidates: Candidate[] = [];
  for (const incident of incidents) {
    const earliestMs = Date.parse(incident.startedAt) - MATCH_RULES.preReportWindowHours * HOUR_MS;
    if (!(acquiredMs >= earliestMs)) continue;
    const distanceKm = haversineKm(observation.location, incident.location);
    if (distanceKm <= MATCH_RULES.matchRadiusKm) candidates.push({ incident, distanceKm });
  }
  return candidates.sort((a, b) => a.distanceKm - b.distanceKm || byId(a.incident, b.incident));
}

function decide(observation: FusionObservation, candidates: Candidate[]): DetectionMatch {
  const [nearest] = candidates;
  const close = candidates.filter((candidate) => candidate.distanceKm - nearest.distanceKm <= MATCH_RULES.ambiguityMarginKm);
  const ambiguous = close.length > 1;
  return {
    detectionId: observation.id,
    status: ambiguous ? "ambiguous" : "matched",
    incidentIds: (ambiguous ? close : [nearest]).map((candidate) => candidate.incident.id),
    distanceKm: roundKm(nearest.distanceKm),
  };
}

function evidenceFor(
  incident: OperationalIncident,
  linked: Array<{ observation: FusionObservation; distanceKm: number }>,
  ambiguousIds: string[],
  now: number,
): IncidentEvidence {
  const newestFirst = [...linked].sort((a, b) =>
    a.observation.acquiredAt === b.observation.acquiredAt
      ? byId(a.observation, b.observation)
      : a.observation.acquiredAt < b.observation.acquiredAt ? 1 : -1);
  const latestDetectionAt = newestFirst[0]?.observation.acquiredAt ?? null;
  const recentAfterMs = now - MATCH_RULES.recentDetectionHours * HOUR_MS;
  const satellite: SatelliteEvidence = latestDetectionAt === null
    ? "none"
    : Date.parse(latestDetectionAt) >= recentAfterMs ? "recent" : "earlier";
  return {
    incidentId: incident.id,
    matchedDetectionIds: newestFirst.map((entry) => entry.observation.id),
    ambiguousDetectionIds: [...ambiguousIds].sort(),
    nearestDetectionKm: linked.length > 0 ? roundKm(Math.min(...linked.map((entry) => entry.distanceKm))) : null,
    latestDetectionAt,
    maxFrpMw: linked.length > 0 ? Math.max(...linked.map((entry) => entry.observation.frpMw)) : null,
    satellite,
  };
}

export function reconcile(incidents: OperationalIncident[], observations: FusionObservation[], now: number): ReconciliationResult {
  const sortedIncidents = [...incidents].sort(byId);
  const uniqueObservations = [...new Map(observations.map((observation) => [observation.id, observation])).values()].sort(byId);

  const linked = new Map<string, Array<{ observation: FusionObservation; distanceKm: number }>>();
  const ambiguous = new Map<string, string[]>();
  const detections: DetectionMatch[] = [];

  for (const observation of uniqueObservations) {
    const candidates = candidatesFor(observation, sortedIncidents);
    if (candidates.length === 0) continue;
    const match = decide(observation, candidates);
    detections.push(match);
    if (match.status === "matched") {
      const entries = linked.get(match.incidentIds[0]) ?? [];
      entries.push({ observation, distanceKm: candidates[0].distanceKm });
      linked.set(match.incidentIds[0], entries);
    } else {
      for (const incidentId of match.incidentIds) ambiguous.set(incidentId, [...(ambiguous.get(incidentId) ?? []), observation.id]);
    }
  }

  return {
    rules: MATCH_RULES,
    incidents: sortedIncidents.map((incident) => evidenceFor(incident, linked.get(incident.id) ?? [], ambiguous.get(incident.id) ?? [], now)),
    detections,
  };
}
