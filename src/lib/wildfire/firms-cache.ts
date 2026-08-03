import { lookupPlace } from "./geo-lookup";
import type { FireSeverity, WildfireEvent } from "./types";

export const FIRMS_CACHE_KEY = "active-fires:v1";

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
    && Array.isArray(payload.points);
}
