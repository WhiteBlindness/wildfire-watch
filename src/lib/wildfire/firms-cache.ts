import { lookupPlace } from "./geo-lookup";
import type { FireSeverity, WildfireEvent } from "./types";

export const FIRMS_CACHE_KEY = "active-fires:v1";
/**
 * A worldwide VIIRS NRT response normally contains tens of thousands of
 * rows. Keep a country-sized or fixture-sized response from replacing the
 * last good global snapshot in KV.
 */
export const FIRMS_MIN_GLOBAL_POINTS = 1_000;

export interface CachedFirmsPoint {
  id: string;
  lat: number;
  lng: number;
  frpMw: number;
  confidencePct: number;
  detectedAt: string;
}

export interface FirmsCachePayload {
  version: 1;
  source: "NASA FIRMS VIIRS_SNPP_NRT";
  generatedAt: string;
  sourceRows: number;
  filteredRows: number;
  points: CachedFirmsPoint[];
}

function severityFromFrp(frpMw: number): FireSeverity {
  if (frpMw >= 150) return "extreme";
  if (frpMw >= 50) return "high";
  if (frpMw >= 10) return "moderate";
  return "low";
}

export function cachedPointToEvent(point: CachedFirmsPoint, generatedAt: string): WildfireEvent {
  const severity = severityFromFrp(point.frpMw);
  const { country, region } = lookupPlace(point.lat, point.lng);

  return {
    id: point.id,
    name: "Satellite thermal anomaly",
    country,
    region,
    location: { lat: point.lat, lng: point.lng },
    status: "active",
    severity,
    startedAt: point.detectedAt,
    estimatedContainmentAt: null,
    containedAt: null,
    areaHectares: 0,
    polygon: null,
    heatmapPoints: [{
      lat: point.lat,
      lng: point.lng,
      intensity: Math.min(1, Math.max(0.15, point.frpMw / 200)),
      detectedAt: point.detectedAt,
    }],
    wind: null,
    forces: null,
    internationalAid: null,
    evolution: null,
    maxFrpMw: point.frpMw,
    satelliteDetection: {
      frpMw: point.frpMw,
      confidencePct: point.confidencePct,
      detectedAt: point.detectedAt,
    },
    source: "firms",
    lastUpdated: generatedAt,
  };
}

export function isFirmsCachePayload(value: unknown): value is FirmsCachePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<FirmsCachePayload>;
  return payload.version === 1
    && payload.source === "NASA FIRMS VIIRS_SNPP_NRT"
    && typeof payload.generatedAt === "string"
    && Number.isInteger(payload.sourceRows)
    && Number.isInteger(payload.filteredRows)
    && Array.isArray(payload.points)
    && payload.points.every((point) => {
      if (!point || typeof point !== "object") return false;
      const candidate = point as Partial<CachedFirmsPoint>;
      const { lat, lng, frpMw, confidencePct } = candidate;
      return typeof candidate.id === "string"
        && typeof lat === "number"
        && Number.isFinite(lat)
        && lat >= -90
        && lat <= 90
        && typeof lng === "number"
        && Number.isFinite(lng)
        && lng >= -180
        && lng <= 180
        && typeof frpMw === "number"
        && Number.isFinite(frpMw)
        && frpMw > 0
        && typeof confidencePct === "number"
        && Number.isFinite(confidencePct)
        && confidencePct >= 0
        && confidencePct <= 100
        && typeof candidate.detectedAt === "string"
        && Number.isFinite(Date.parse(candidate.detectedAt));
    });
}

/** Validate the invariants required before a payload is exposed as global data. */
export function isGlobalFirmsCachePayload(value: unknown): value is FirmsCachePayload {
  if (!isFirmsCachePayload(value)) return false;
  if (value.points.length < FIRMS_MIN_GLOBAL_POINTS) return false;

  const longitudeBands = new Set(value.points.map((point) => Math.floor((point.lng + 180) / 30)));
  const latitudeBands = new Set(value.points.map((point) => Math.floor((point.lat + 90) / 30)));
  return longitudeBands.size >= 8 && latitudeBands.size >= 4;
}
