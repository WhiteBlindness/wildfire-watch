import { getPhysicalFeatures } from "./features";
import { haversineKm } from "./haversine";
import type { PhysicalFeature, PhysicalFeatureKind } from "./types";

export interface NearestFeatureResult {
  feature: PhysicalFeature;
  distanceKm: number;
}

function findNearestOfKind(
  kind: PhysicalFeatureKind,
  lat: number,
  lng: number,
  maxKm: number,
): NearestFeatureResult | null {
  let best: NearestFeatureResult | null = null;

  for (const feature of getPhysicalFeatures()) {
    if (feature.kind !== kind) continue;
    const distanceKm = haversineKm({ lat, lng }, { lat: feature.lat, lng: feature.lng });
    if (distanceKm > maxKm) continue;
    if (!best || distanceKm < best.distanceKm) {
      best = { feature, distanceKm };
    }
  }

  return best;
}

/**
 * Nearest volcano to a coordinate within `maxKm`, or null if none qualify.
 * Intended for detail-panel copy like "8 km from Etna" — a proximity fact,
 * never an implication that the volcano caused the detection.
 */
export function findNearestVolcano(lat: number, lng: number, maxKm: number): NearestFeatureResult | null {
  return findNearestOfKind("volcano", lat, lng, maxKm);
}

/** Nearest mountain range to a coordinate within `maxKm`, or null if none qualify. */
export function findNearestRange(lat: number, lng: number, maxKm: number): NearestFeatureResult | null {
  return findNearestOfKind("range", lat, lng, maxKm);
}
