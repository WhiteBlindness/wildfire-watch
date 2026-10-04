import type { DatasetProvenance, GeoPoint, OperationalIncident, OperationalPhase, OperationalResources } from "@/lib/wildfire/types";

/**
 * ANEPC (Autoridade Nacional de Emergência e Proteção Civil) publishes the
 * occurrences open in mainland Portugal through the ArcGIS feature layer
 * behind its public occurrences map, also listed as the open dataset
 * "ProCiv – Ocorrências em aberto" on dados.gov.pt. Each record is an
 * operational incident as the authority registers it: a phase, a nature code,
 * a registered location and the resources committed. It is not a satellite
 * observation and not a fire perimeter.
 *
 * The layer has no versioned contract, so everything here is defensive: the
 * query asks for all fields and parses what it recognises, a record that
 * cannot be read is dropped and counted, and a response in which no rural
 * fire can be read at all fails the run, which keeps the last good snapshot.
 */

export const ANEPC_DATASET: DatasetProvenance = {
  id: "anepc:ocorrencias-em-aberto",
  provider: "ANEPC",
  product: "Ocorrências em aberto",
  instrument: "Registo operacional (SADO)",
  observationKind: "operational_incident_report",
  reportsOperationalStatus: true,
  attribution: "ANEPC — Autoridade Nacional de Emergência e Proteção Civil",
  sourceUrl: "https://dados.gov.pt/pt/datasets/prociv-ocorrencias-em-aberto/",
};

const ANEPC_LAYER_URL = "https://services-eu1.arcgis.com/VlrHb7fn5ewYhX6y/arcgis/rest/services/OcorrenciasSite/FeatureServer/0";

/** Mainland Portugal with a small margin; the layer does not cover the autonomous regions. */
export const ANEPC_COVERAGE = { west: -9.6, south: 36.9, east: -6.1, north: 42.2 } as const;

/**
 * Nature codes 31xx are rural fires. Three of them are not wildfires in their
 * own right: 3107 consolidation of a previous fire's mop-up, 3109 fuel
 * management and 3111 debris burning.
 */
const RURAL_FIRE_PREFIX = "31";
const NOT_WILDFIRE_CODES = new Set(["3107", "3109", "3111"]);

/** A record published more than this far in the future is a clock or format error. */
const FUTURE_TOLERANCE_MS = 60 * 60 * 1_000;
const MAX_TEXT_LENGTH = 80;
const MAX_COUNT = 10_000;
const MAX_UNRECOGNISED_PHASES = 10;

export type AnepcFeedErrorCode = "http_error" | "parse_error";

export class AnepcFeedError extends Error {
  constructor(readonly code: AnepcFeedErrorCode) {
    super(`ANEPC feed rejected (${code})`);
    this.name = "AnepcFeedError";
  }
}

export interface AnepcParseResult {
  incidents: OperationalIncident[];
  /** Same meaning as the FIRMS counts: rows returned, rural-fire rows, incidents kept. */
  counts: { sourceRows: number; filteredRows: number; selectedPoints: number };
  quality: {
    /** Rural-fire records dropped because a required field was missing or out of range. */
    invalidRecords: number;
    duplicateRecords: number;
    /** Phase labels the mapping did not recognise, kept verbatim (a sign the source changed). */
    unrecognisedPhases: string[];
    /** The layer said more records exist than it returned. */
    truncated: boolean;
  };
}

export function buildAnepcQueryUrl(): string {
  const params = new URLSearchParams({
    where: "1=1",
    // Every field: asking for a named field the layer has renamed would fail the whole query.
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
  });
  return `${ANEPC_LAYER_URL}/query?${params}`;
}

function normaliseLabel(label: string): string {
  return label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Maps the source's phase label; null means a closed occurrence, which is not shown. */
export function mapAnepcPhase(label: string): OperationalPhase | null {
  const normalised = normaliseLabel(label);
  if (/encerrad|fechad/.test(normalised)) return null;
  if (normalised.includes("despacho")) return "dispatch";
  if (normalised === "em curso") return "in_progress";
  if (normalised.includes("resolucao")) return "resolving";
  if (normalised.includes("conclusao")) return "concluding";
  if (normalised.includes("vigilancia")) return "surveillance";
  return "other";
}

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value).replace(/\s+/g, " ").trim();
  return cleaned && cleaned.length <= MAX_TEXT_LENGTH ? cleaned : null;
}

function count(value: unknown): number | null {
  const parsed = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_COUNT ? parsed : null;
}

function coordinate(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

/** ArcGIS JSON dates are epoch milliseconds (UTC); an ISO string is accepted only with an explicit offset. */
function timestamp(value: unknown, now: number): string | null {
  let ms: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) ms = value;
  else if (typeof value === "string" && /(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim())) ms = Date.parse(value);
  if (ms === null || !Number.isFinite(ms) || ms > now + FUTURE_TOLERANCE_MS || ms < Date.UTC(2000, 0, 1)) return null;
  return new Date(ms).toISOString();
}

function natureCode(attributes: Record<string, unknown>): string | null {
  const direct = text(attributes.CodNatureza);
  if (direct && /^\d{4}$/.test(direct)) return direct;
  const fromLabel = text(attributes.Natureza)?.match(/^(\d{4})\b/);
  return fromLabel ? fromLabel[1] : null;
}

function location(attributes: Record<string, unknown>, geometry: unknown): GeoPoint | null {
  const shape = geometry && typeof geometry === "object" ? geometry as Record<string, unknown> : null;
  const lng = coordinate(shape?.x) ?? coordinate(attributes.Longitude);
  const lat = coordinate(shape?.y) ?? coordinate(attributes.Latitude);
  if (lat === null || lng === null) return null;
  const inside = lng >= ANEPC_COVERAGE.west && lng <= ANEPC_COVERAGE.east && lat >= ANEPC_COVERAGE.south && lat <= ANEPC_COVERAGE.north;
  return inside ? { lat, lng } : null;
}

function resources(attributes: Record<string, unknown>): OperationalResources {
  return {
    personnel: count(attributes.Operacionais),
    groundVehicles: count(attributes.MeiosTerrestres),
    aircraft: count(attributes.MeiosAereos),
  };
}

type RecordOutcome =
  | { kind: "not_rural_fire" }
  | { kind: "closed" }
  | { kind: "invalid" }
  | { kind: "incident"; incident: OperationalIncident };

function readRecord(raw: unknown, now: number): RecordOutcome & { hasNatureCode: boolean } {
  const featureRecord = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const attributes = featureRecord.attributes && typeof featureRecord.attributes === "object"
    ? featureRecord.attributes as Record<string, unknown>
    : {};
  const code = natureCode(attributes);
  if (!code) return { kind: "not_rural_fire", hasNatureCode: false };
  if (!code.startsWith(RURAL_FIRE_PREFIX) || NOT_WILDFIRE_CODES.has(code)) return { kind: "not_rural_fire", hasNatureCode: true };

  const sourceId = text(attributes.Numero) ?? text(attributes.ID_oc);
  const phaseLabel = text(attributes.EstadoAgrupado) ?? text(attributes.EstadoOcorrencia);
  const startedAt = timestamp(attributes.DataOcorrencia, now);
  const point = location(attributes, featureRecord.geometry);
  if (!sourceId || !phaseLabel || !startedAt || !point) return { kind: "invalid", hasNatureCode: true };

  const phase = mapAnepcPhase(phaseLabel);
  if (phase === null) return { kind: "closed", hasNatureCode: true };

  const natureLabel = text(attributes.Natureza);
  return {
    kind: "incident",
    hasNatureCode: true,
    incident: {
      kind: "operational_incident",
      id: `anepc:${sourceId}`,
      datasetId: ANEPC_DATASET.id,
      sourceId,
      location: point,
      phase,
      phaseLabel,
      natureCode: code,
      natureLabel,
      startedAt,
      updatedAt: timestamp(attributes.DataDosDados, now),
      municipality: text(attributes.Concelho),
      parish: text(attributes.Freguesia),
      resources: resources(attributes),
    },
  };
}

function isNewer(candidate: OperationalIncident, current: OperationalIncident): boolean {
  return (candidate.updatedAt ?? "") > (current.updatedAt ?? "");
}

function compareIncidents(a: OperationalIncident, b: OperationalIncident): number {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? 1 : -1;
  return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
}

/** Parses an ArcGIS `f=json` query response. Throws AnepcFeedError when nothing can be trusted. */
export function parseAnepcOccurrences(body: unknown, now: number): AnepcParseResult {
  const response = body && typeof body === "object" ? body as Record<string, unknown> : null;
  if (response?.error) throw new AnepcFeedError("http_error");
  if (!response || !Array.isArray(response.features)) throw new AnepcFeedError("parse_error");

  const byId = new Map<string, OperationalIncident>();
  const unrecognisedPhases = new Set<string>();
  let filteredRows = 0;
  let invalidRecords = 0;
  let duplicateRecords = 0;
  let rowsWithCode = 0;

  for (const raw of response.features) {
    const outcome = readRecord(raw, now);
    if (outcome.hasNatureCode) rowsWithCode += 1;
    if (outcome.kind === "not_rural_fire") continue;
    filteredRows += 1;
    if (outcome.kind === "invalid") {
      invalidRecords += 1;
      continue;
    }
    if (outcome.kind === "closed") continue;

    const { incident } = outcome;
    if (incident.phase === "other" && unrecognisedPhases.size < MAX_UNRECOGNISED_PHASES) unrecognisedPhases.add(incident.phaseLabel);
    const existing = byId.get(incident.id);
    if (existing) {
      duplicateRecords += 1;
      if (!isNewer(incident, existing)) continue;
    }
    byId.set(incident.id, incident);
  }

  const sourceRows = response.features.length;
  // Rows arrived but no nature code could be read: the layer's fields changed.
  if (sourceRows > 0 && rowsWithCode === 0) throw new AnepcFeedError("parse_error");
  // Rural fires arrived but not one could be read.
  if (filteredRows > 0 && invalidRecords === filteredRows) throw new AnepcFeedError("parse_error");

  const incidents = [...byId.values()].sort(compareIncidents);
  return {
    incidents,
    counts: { sourceRows, filteredRows, selectedPoints: incidents.length },
    quality: {
      invalidRecords,
      duplicateRecords,
      unrecognisedPhases: [...unrecognisedPhases].sort(),
      truncated: response.exceededTransferLimit === true,
    },
  };
}
