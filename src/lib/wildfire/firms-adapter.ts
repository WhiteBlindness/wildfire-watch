import "server-only";

import { lookupPlace } from "./geo-lookup";
import { createSimulatedTelemetry } from "./telemetry";
import type { FireSeverity, WildfireDataAdapter, WildfireEvent } from "./types";

// NASA FIRMS "area" API: real active-fire hotspot detections from the
// VIIRS_SNPP_NRT sensor, near-real-time (typically a few hours old). Free,
// but requires a MAP_KEY: https://firms.modaps.eosdis.nasa.gov/api/map_key/
const FIRMS_BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const FIRMS_SOURCE = "VIIRS_SNPP_NRT";
const FIRMS_DAY_RANGE = 1;
// 5-minute edge cache: FIRMS itself only refreshes NRT data every few hours,
// and this keeps us well under their 5000 req/10min rate limit even under load.
const REVALIDATE_SECONDS = 300;

interface FirmsRow {
  latitude: number;
  longitude: number;
  frp: number;
  confidence: number;
  acqDate: string;
  acqTime: string;
}

function parseConfidence(raw: string): number {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "l" || trimmed === "low") return 30;
  if (trimmed === "n" || trimmed === "nominal") return 65;
  if (trimmed === "h" || trimmed === "high") return 90;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseCsv(csv: string): FirmsRow[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((item) => item.trim().toLowerCase());
  const column = (name: string) => header.indexOf(name);
  const latIdx = column("latitude");
  const lngIdx = column("longitude");
  const frpIdx = column("frp");
  const confidenceIdx = column("confidence");
  const dateIdx = column("acq_date");
  const timeIdx = column("acq_time");

  if (latIdx === -1 || lngIdx === -1) return [];

  const rows: FirmsRow[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const cells = lines[index].split(",");
    if (cells.length < header.length) continue;

    const latitude = Number(cells[latIdx]);
    const longitude = Number(cells[lngIdx]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    rows.push({
      latitude,
      longitude,
      frp: frpIdx !== -1 ? Number(cells[frpIdx]) || 0 : 0,
      confidence: confidenceIdx !== -1 ? parseConfidence(cells[confidenceIdx]) : 65,
      acqDate: dateIdx !== -1 ? cells[dateIdx].trim() : "",
      acqTime: timeIdx !== -1 ? cells[timeIdx].trim().padStart(4, "0") : "0000",
    });
  }
  return rows;
}

function toIsoTimestamp(acqDate: string, acqTime: string): string {
  if (!acqDate) return new Date().toISOString();
  const hours = acqTime.slice(0, 2) || "00";
  const minutes = acqTime.slice(2, 4) || "00";
  return new Date(`${acqDate}T${hours}:${minutes}:00Z`).toISOString();
}

function severityFromFrp(frp: number): FireSeverity {
  if (frp >= 150) return "extreme";
  if (frp >= 50) return "high";
  if (frp >= 10) return "moderate";
  return "low";
}

function rowToEvent(row: FirmsRow, index: number): WildfireEvent {
  const detectedAt = toIsoTimestamp(row.acqDate, row.acqTime);
  const { country, region } = lookupPlace(row.latitude, row.longitude);

  return {
    id: `firms-${row.acqDate}-${row.acqTime}-${row.latitude.toFixed(4)}-${row.longitude.toFixed(4)}-${index}`,
    name: "Anomalia térmica detetada por satélite",
    country,
    region,
    location: { lat: row.latitude, lng: row.longitude },
    status: "active",
    severity: severityFromFrp(row.frp),
    startedAt: detectedAt,
    estimatedContainmentAt: null,
    containedAt: null,
    // A thermal anomaly is not a measured burned area. The client renders a
    // clearly labeled reference perimeter only after this point is selected.
    areaHectares: 0,
    polygon: null,
    heatmapPoints: [{
      lat: row.latitude,
      lng: row.longitude,
      intensity: Math.min(1, Math.max(0.15, row.frp / 200)),
      detectedAt,
    }],
    wind: null,
    forces: null,
    internationalAid: null,
    evolution: null,
    telemetry: createSimulatedTelemetry(
      `firms-${row.acqDate}-${row.acqTime}-${row.latitude}-${row.longitude}`,
      detectedAt,
      row.frp,
      severityFromFrp(row.frp),
    ),
    maxFrpMw: row.frp,
    satelliteDetection: {
      frpMw: row.frp,
      confidencePct: row.confidence,
      detectedAt,
    },
    source: "firms",
    lastUpdated: new Date().toISOString(),
  };
}

async function fetchEvents(): Promise<WildfireEvent[]> {
  const mapKey = process.env.FIRMS_MAP_KEY;
  if (!mapKey) throw new Error("FIRMS_MAP_KEY is not set");

  const url = `${FIRMS_BASE_URL}/${mapKey}/${FIRMS_SOURCE}/world/${FIRMS_DAY_RANGE}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`FIRMS request failed: ${response.status} ${response.statusText}`);
  }

  const rows = parseCsv(await response.text()).filter((row) => row.confidence >= 50);
  // Do not aggregate thermal anomalies into regional/grid-cell incidents.
  // Every qualifying FIRMS row remains an independently selectable hotspot.
  return rows.map(rowToEvent);
}

// Cache the processed result only. The raw world CSV is multi-megabyte and
// exceeds the platform data-cache ceiling; a warm edge isolate safely reuses
// the individual detections for this short window.
let cachedResult: { events: WildfireEvent[]; expiresAt: number } | null = null;
let pending: Promise<WildfireEvent[]> | null = null;

async function getCachedEvents(): Promise<WildfireEvent[]> {
  const now = Date.now();
  if (cachedResult && cachedResult.expiresAt > now) return cachedResult.events;
  if (!pending) {
    pending = fetchEvents().finally(() => {
      pending = null;
    });
  }
  const events = await pending;
  cachedResult = { events, expiresAt: now + REVALIDATE_SECONDS * 1000 };
  return events;
}

export const firmsAdapter: WildfireDataAdapter = {
  async listEvents(): Promise<WildfireEvent[]> {
    return getCachedEvents();
  },
  async getEvent(id: string): Promise<WildfireEvent | null> {
    const events = await getCachedEvents();
    return events.find((event) => event.id === id) ?? null;
  },
};
