import "server-only";

import { convexHull, hullAreaKm2 } from "./hull";
import { lookupPlace } from "./geo-lookup";
import type {
  FireSeverity,
  HeatmapPoint,
  WildfireDataAdapter,
  WildfireEvent,
} from "./types";

// NASA FIRMS "area" API: real active-fire hotspot detections from the
// VIIRS_SNPP_NRT sensor, near-real-time (typically a few hours old). Free,
// but requires a MAP_KEY: https://firms.modaps.eosdis.nasa.gov/api/map_key/
const FIRMS_BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const FIRMS_SOURCE = "VIIRS_SNPP_NRT";
const FIRMS_DAY_RANGE = 1;
// 5-minute edge cache: FIRMS itself only refreshes NRT data every few hours,
// and this keeps us well under their 5000 req/10min rate limit even under load.
const REVALIDATE_SECONDS = 300;

// Grid-cell size (degrees) used to cluster raw hotspot points into "events".
// ~0.5° is roughly 50-55km at the equator — coarse enough that a single
// active fire's scattered detections group together, fine enough that
// distinct fires in the same region stay separate.
const CLUSTER_CELL_SIZE = 0.5;

// A single VIIRS NRT world query returns tens of thousands of hotspots —
// mostly small agricultural burns, not the "named incident" fires this
// product is about. A cluster is only promoted to a clickable event when it
// clears both bars below; everything else still exists in FIRMS, it's just
// not significant enough to surface as its own marker/panel here.
const MIN_CLUSTER_POINTS = 4;
const MIN_CLUSTER_TOTAL_FRP = 40;
// Hard cap so a very active day (e.g. peak wildfire season) still renders a
// scannable map instead of hundreds of overlapping markers — "clarity over
// density" per the product's design principles. Keeps the most intense
// complexes globally, ranked by total radiative power.
const MAX_EVENTS = 200;

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

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);

  const latIdx = col("latitude");
  const lngIdx = col("longitude");
  const frpIdx = col("frp");
  const confIdx = col("confidence");
  const dateIdx = col("acq_date");
  const timeIdx = col("acq_time");

  if (latIdx === -1 || lngIdx === -1) return [];

  const rows: FirmsRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    if (cells.length < header.length) continue;
    const latitude = Number(cells[latIdx]);
    const longitude = Number(cells[lngIdx]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    rows.push({
      latitude,
      longitude,
      frp: frpIdx !== -1 ? Number(cells[frpIdx]) || 0 : 0,
      confidence: confIdx !== -1 ? parseConfidence(cells[confIdx]) : 65,
      acqDate: dateIdx !== -1 ? cells[dateIdx].trim() : "",
      acqTime: timeIdx !== -1 ? cells[timeIdx].trim().padStart(4, "0") : "0000",
    });
  }
  return rows;
}

function toIsoTimestamp(acqDate: string, acqTime: string): string {
  if (!acqDate) return new Date().toISOString();
  const hh = acqTime.slice(0, 2) || "00";
  const mm = acqTime.slice(2, 4) || "00";
  return new Date(`${acqDate}T${hh}:${mm}:00Z`).toISOString();
}

function severityFromFrp(maxFrp: number): FireSeverity {
  if (maxFrp >= 150) return "extreme";
  if (maxFrp >= 50) return "high";
  if (maxFrp >= 10) return "moderate";
  return "low";
}

function clusterKey(lat: number, lng: number, date: string): string {
  const cellLat = Math.round(lat / CLUSTER_CELL_SIZE);
  const cellLng = Math.round(lng / CLUSTER_CELL_SIZE);
  return `${date}_${cellLat}_${cellLng}`;
}

function rowsToEvent(key: string, rows: FirmsRow[]): WildfireEvent {
  const points = rows.map((r) => ({ lat: r.latitude, lng: r.longitude }));
  const centroidLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const centroidLng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;

  const maxFrp = Math.max(...rows.map((r) => r.frp));
  const severity = severityFromFrp(maxFrp);
  const polygon = convexHull(points);
  // A lone or duplicate-only detection still occupies roughly one VIIRS
  // pixel footprint (~0.15km²) — an honest lower-bound estimate, not a
  // fabricated burned-area measurement.
  const areaHectares = Math.round((polygon ? hullAreaKm2(polygon) : 0.15) * 100);

  const heatmapPoints: HeatmapPoint[] = rows.map((r) => ({
    lat: r.latitude,
    lng: r.longitude,
    intensity: Math.min(1, Math.max(0.15, r.frp / 200)),
    detectedAt: toIsoTimestamp(r.acqDate, r.acqTime),
  }));

  const startedAt = heatmapPoints.reduce(
    (earliest, p) => (p.detectedAt < earliest ? p.detectedAt : earliest),
    heatmapPoints[0].detectedAt,
  );

  const { country, region } = lookupPlace(centroidLat, centroidLng);

  return {
    id: `firms-${key}`,
    name: `Foco ativo detetado por satélite (${rows.length} deteç${rows.length === 1 ? "ão" : "ões"})`,
    country,
    region,
    location: { lat: centroidLat, lng: centroidLng },
    status: "active",
    severity,
    startedAt,
    estimatedContainmentAt: null,
    containedAt: null,
    areaHectares,
    polygon,
    heatmapPoints,
    wind: null,
    forces: null,
    internationalAid: null,
    evolution: null,
    maxFrpMw: maxFrp,
    source: "firms",
    lastUpdated: new Date().toISOString(),
  };
}

async function fetchEvents(): Promise<WildfireEvent[]> {
  const mapKey = process.env.FIRMS_MAP_KEY;
  if (!mapKey) {
    throw new Error("FIRMS_MAP_KEY is not set");
  }

  const url = `${FIRMS_BASE_URL}/${mapKey}/${FIRMS_SOURCE}/world/${FIRMS_DAY_RANGE}`;
  // A world/1-day VIIRS pull is ~6-7MB of CSV — over Next's data-cache size
  // ceiling (2MB), so `next: { revalidate }` on this fetch would silently
  // fail to cache and re-fetch every request. We cache the small *processed*
  // result instead (see getCachedEvents below); this fetch intentionally
  // bypasses Next's cache.
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`FIRMS request failed: ${response.status} ${response.statusText}`);
  }

  const csv = await response.text();
  const rows = parseCsv(csv).filter((r) => r.confidence >= 50);

  const clusters = new Map<string, FirmsRow[]>();
  for (const row of rows) {
    const key = clusterKey(row.latitude, row.longitude, row.acqDate);
    const existing = clusters.get(key);
    if (existing) {
      existing.push(row);
    } else {
      clusters.set(key, [row]);
    }
  }

  const significant = Array.from(clusters.entries()).filter(([, clusterRows]) => {
    const totalFrp = clusterRows.reduce((sum, r) => sum + r.frp, 0);
    return clusterRows.length >= MIN_CLUSTER_POINTS && totalFrp >= MIN_CLUSTER_TOTAL_FRP;
  });

  significant.sort(
    (a, b) => b[1].reduce((sum, r) => sum + r.frp, 0) - a[1].reduce((sum, r) => sum + r.frp, 0),
  );

  return significant.slice(0, MAX_EVENTS).map(([key, clusterRows]) => rowsToEvent(key, clusterRows));
}

// Module-scope cache of the small processed result (≈200 events, a few
// hundred KB), not the raw multi-megabyte feed. On Cloudflare Workers this
// lives for as long as the isolate stays warm — same 5-minute-window effect
// as a `revalidate` fetch cache would give, without hitting the data-cache
// size ceiling above. Every warm request inside the window reuses it; a cold
// isolate or an expired window triggers exactly one real FIRMS fetch.
let cachedResult: { events: WildfireEvent[]; expiresAt: number } | null = null;
let pending: Promise<WildfireEvent[]> | null = null;

async function getCachedEvents(): Promise<WildfireEvent[]> {
  const now = Date.now();
  if (cachedResult && cachedResult.expiresAt > now) return cachedResult.events;
  // Concurrent requests during a cold/expired window share one in-flight
  // fetch instead of each triggering their own FIRMS request.
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
