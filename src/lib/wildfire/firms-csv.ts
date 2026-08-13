/**
 * Shared FIRMS CSV parsing and point-construction utilities.
 * Used by both the global ingest worker and the fire-detail API route.
 */

import type { CachedFirmsPoint } from "./firms-cache";

const FIRMS_TIMESTAMP_FUTURE_TOLERANCE_MS = 6 * 60 * 60 * 1_000;

/**
 * VIIRS pixel dimensions are published as nominal 375 m at nadir, but the real
 * ground footprint grows toward the scan-swath edge.  The FIRMS CSV reports the
 * actual per-detection dimensions in the `scan` (along-scan, roughly E-W) and
 * `track` (along-track, roughly N-S) columns, both in kilometres.
 *
 * Clamp limits (km) — a pixel cannot physically be smaller than nadir-view
 * (rounds to 0.3 km accounting for quantisation) nor larger than the extreme
 * swath edge (measured maximum in the real feed is ~1.5 km; 2.0 gives headroom
 * without accepting obviously corrupt values).
 */
export const VIIRS_SCAN_TRACK_MIN_KM = 0.3;
export const VIIRS_SCAN_TRACK_MAX_KM = 2.0;

export interface ParsedRow {
  lat: number;
  lng: number;
  frpMw: number;
  confidencePct: number;
  detectedAt: string;
  /** Along-scan (roughly E-W) pixel dimension in km. Absent when the CSV lacks the column. */
  scanKm?: number;
  /** Along-track (roughly N-S) pixel dimension in km. Absent when the CSV lacks the column. */
  trackKm?: number;
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
  const point: CachedFirmsPoint = {
    id: `firms-${hash(fingerprint).toString(36)}`,
    lat,
    lng,
    frpMw: Math.round(row.frpMw * 10) / 10,
    confidencePct: Math.round(row.confidencePct),
    detectedAt: row.detectedAt,
  };
  // Only write scanKm/trackKm when present so existing payloads without these
  // fields remain structurally identical and validators don't reject them.
  if (row.scanKm !== undefined) point.scanKm = row.scanKm;
  if (row.trackKm !== undefined) point.trackKm = row.trackKm;
  return point;
}

/**
 * Column indices derived from a CSV header row.
 * Exported so the streaming path in firms-ingest.ts can reuse the same
 * header-parsing logic without maintaining a separate copy.
 *
 * scanIndex / trackIndex are -1 when the column is absent; that is valid
 * (older FIRMS endpoints or non-VIIRS sources may omit them) and callers
 * must treat -1 as "unavailable, fall back to nominal".
 */
export interface FirmsCsvColumnIndices {
  latIndex: number;
  lngIndex: number;
  frpIndex: number;
  confidenceIndex: number;
  dateIndex: number;
  timeIndex: number;
  /** Index of the `scan` column, or -1 when absent. */
  scanIndex: number;
  /** Index of the `track` column, or -1 when absent. */
  trackIndex: number;
}

/**
 * Parse the header row of a FIRMS CSV into column indices.
 * Throws if required columns are missing (same behaviour as parseCsv).
 */
export function parseFirmsCsvHeader(headerLine: string): FirmsCsvColumnIndices {
  const header = headerLine.split(",").map((cell) => cell.trim().toLowerCase());
  const indexOf = (name: string): number => header.indexOf(name);
  const latIndex = indexOf("latitude");
  const lngIndex = indexOf("longitude");
  const frpIndex = indexOf("frp");
  const confidenceIndex = indexOf("confidence");
  const dateIndex = indexOf("acq_date");
  const timeIndex = indexOf("acq_time");
  // scan/track are optional — absent in non-VIIRS feeds and some older endpoints.
  // -1 signals "not available"; callers fall back to nominal 375 m.
  const scanIndex = indexOf("scan");
  const trackIndex = indexOf("track");
  if (latIndex < 0 || lngIndex < 0 || dateIndex < 0 || timeIndex < 0) {
    throw new Error("NASA FIRMS CSV is missing required columns");
  }
  return { latIndex, lngIndex, frpIndex, confidenceIndex, dateIndex, timeIndex, scanIndex, trackIndex };
}

/**
 * Parse a single CSV data line into a ParsedRow, returning null when the row
 * fails any filter (confidence < 50, frp <= 0, invalid coords, invalid
 * timestamp, or too few cells).
 *
 * This is the SINGLE canonical implementation of per-row interpretation shared
 * between parseCsv (whole-body) and the streaming path in firms-ingest.ts.
 * Keeping it here ensures the two callers can never silently diverge.
 */
export function parseDataLine(
  line: string,
  cols: FirmsCsvColumnIndices,
  expectedCellCount: number,
): ParsedRow | null {
  const cells = line.split(",");
  // Mirror parseCsv's `cells.length < header.length` check exactly.
  if (cells.length < expectedCellCount) return null;

  const lat = Number(cells[cols.latIndex]);
  const lng = Number(cells[cols.lngIndex]);
  const frpMw = cols.frpIndex >= 0 ? Number(cells[cols.frpIndex]) : 0;
  const confidencePct = cols.confidenceIndex >= 0 ? parseConfidence(cells[cols.confidenceIndex]) : 65;
  const detectedAt = toTimestamp(cells[cols.dateIndex].trim(), cells[cols.timeIndex]);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(frpMw)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (confidencePct < 50 || frpMw <= 0 || !detectedAt) return null;

  // Parse per-detection pixel dimensions.  Both columns are optional — absent
  // or unparseable means leave the field undefined so viirs.ts can apply the
  // documented nominal.  Out-of-range values are clamped (not rejected) because
  // the feed occasionally reports sub-nominal values at extreme scan angles;
  // clamping to the stated range is safer than silently dropping the detection.
  const row: ParsedRow = { lat, lng, frpMw, confidencePct, detectedAt };

  if (cols.scanIndex >= 0) {
    const rawScan = Number(cells[cols.scanIndex]);
    if (Number.isFinite(rawScan) && rawScan > 0) {
      row.scanKm = Math.min(Math.max(rawScan, VIIRS_SCAN_TRACK_MIN_KM), VIIRS_SCAN_TRACK_MAX_KM);
    }
  }
  if (cols.trackIndex >= 0) {
    const rawTrack = Number(cells[cols.trackIndex]);
    if (Number.isFinite(rawTrack) && rawTrack > 0) {
      row.trackKm = Math.min(Math.max(rawTrack, VIIRS_SCAN_TRACK_MIN_KM), VIIRS_SCAN_TRACK_MAX_KM);
    }
  }

  return row;
}

export function parseCsv(csv: string): { sourceRows: number; rows: ParsedRow[] } {
  // Trim the whole body so a trailing newline does not produce a spurious
  // empty final line — this matches what the streaming path does at flush.
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return { sourceRows: 0, rows: [] };

  const cols = parseFirmsCsvHeader(lines[0]);
  const expectedCellCount = lines[0].split(",").length;

  const rows: ParsedRow[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const parsed = parseDataLine(lines[index], cols, expectedCellCount);
    if (parsed !== null) rows.push(parsed);
  }

  // sourceRows counts every data line including ones skipped for bad cell count
  // or failed filters — same semantics as before.
  return { sourceRows: lines.length - 1, rows };
}
