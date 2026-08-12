/**
 * Shared FIRMS CSV parsing and point-construction utilities.
 * Used by both the global ingest worker and the fire-detail API route.
 */

import type { CachedFirmsPoint } from "./firms-cache";

const FIRMS_TIMESTAMP_FUTURE_TOLERANCE_MS = 6 * 60 * 60 * 1_000;

export interface ParsedRow {
  lat: number;
  lng: number;
  frpMw: number;
  confidencePct: number;
  detectedAt: string;
}

// Re-export so callers that previously imported CsvPoint from this module
// can continue to do so without a breaking change.
export type { CachedFirmsPoint as CsvPoint };

function parseConfidence(raw: string): number {
  const value = raw.trim().toLowerCase();
  if (value === "l" || value === "low") return 30;
  if (value === "n" || value === "nominal") return 65;
  if (value === "h" || value === "high") return 90;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function toTimestamp(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return null;
  const hhmm = time.trim().padStart(4, "0");
  if (!/^\d{4}$/.test(hhmm)) return null;

  const [year, month, day] = date.trim().split("-").map(Number);
  const hours = Number(hhmm.slice(0, 2));
  const minutes = Number(hhmm.slice(2, 4));
  if (hours > 23 || minutes > 59) return null;

  const timestamp = Date.UTC(year, month - 1, day, hours, minutes);
  const parsed = new Date(timestamp);
  // Date.UTC normalizes impossible dates (for example, 31 February), so
  // compare the UTC components back to the source fields before accepting it.
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
    || timestamp > Date.now() + FIRMS_TIMESTAMP_FUTURE_TOLERANCE_MS
  ) {
    return null;
  }
  return parsed.toISOString();
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

export function toPoint(row: ParsedRow): CachedFirmsPoint {
  const lat = Math.round(row.lat * 10_000) / 10_000;
  const lng = Math.round(row.lng * 10_000) / 10_000;
  const fingerprint = `${row.detectedAt}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
  return {
    id: `firms-${hash(fingerprint).toString(36)}`,
    lat,
    lng,
    frpMw: Math.round(row.frpMw * 10) / 10,
    confidencePct: Math.round(row.confidencePct),
    detectedAt: row.detectedAt,
  };
}

export function parseCsv(csv: string): { sourceRows: number; rows: ParsedRow[] } {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return { sourceRows: 0, rows: [] };

  const header = lines[0].split(",").map((cell) => cell.trim().toLowerCase());
  const indexOf = (name: string): number => header.indexOf(name);
  const latIndex = indexOf("latitude");
  const lngIndex = indexOf("longitude");
  const frpIndex = indexOf("frp");
  const confidenceIndex = indexOf("confidence");
  const dateIndex = indexOf("acq_date");
  const timeIndex = indexOf("acq_time");
  if (latIndex < 0 || lngIndex < 0 || dateIndex < 0 || timeIndex < 0) {
    throw new Error("NASA FIRMS CSV is missing required columns");
  }

  const rows: ParsedRow[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const cells = lines[index].split(",");
    if (cells.length < header.length) continue;

    const lat = Number(cells[latIndex]);
    const lng = Number(cells[lngIndex]);
    const frpMw = frpIndex >= 0 ? Number(cells[frpIndex]) : 0;
    const confidencePct = confidenceIndex >= 0 ? parseConfidence(cells[confidenceIndex]) : 65;
    const detectedAt = toTimestamp(cells[dateIndex].trim(), cells[timeIndex]);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(frpMw)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    if (confidencePct < 50 || frpMw <= 0 || !detectedAt) continue;
    rows.push({ lat, lng, frpMw, confidencePct, detectedAt });
  }

  return { sourceRows: lines.length - 1, rows };
}
