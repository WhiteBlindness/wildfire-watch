import "server-only";

import type { GeoPoint } from "./types";

/** Andrew's monotone chain convex hull. Returns a closed ring (first point
 * repeated at the end) or null when fewer than 3 distinct points are given —
 * we only draw a real hull around real detections, never a fabricated shape. */
export function convexHull(points: GeoPoint[]): GeoPoint[] | null {
  const unique = dedupe(points);
  if (unique.length < 3) return null;

  const sorted = [...unique].sort((a, b) => (a.lng === b.lng ? a.lat - b.lat : a.lng - b.lng));

  const cross = (o: GeoPoint, a: GeoPoint, b: GeoPoint) =>
    (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);

  const lower: GeoPoint[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: GeoPoint[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (hull.length < 3) return null;
  return [...hull, hull[0]];
}

/** Shoelace formula, converting degrees to km via an equirectangular
 * approximation at the ring's mean latitude — accurate enough for the small
 * (city-scale) extents a single fire cluster spans. Returns km². */
export function hullAreaKm2(ring: GeoPoint[]): number {
  if (ring.length < 4) return 0;
  const meanLat = ring.reduce((sum, p) => sum + p.lat, 0) / ring.length;
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos((meanLat * Math.PI) / 180);

  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = ring[i];
    const p2 = ring[i + 1];
    const x1 = p1.lng * kmPerDegLng;
    const y1 = p1.lat * kmPerDegLat;
    const x2 = p2.lng * kmPerDegLng;
    const y2 = p2.lat * kmPerDegLat;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

function dedupe(points: GeoPoint[]): GeoPoint[] {
  const seen = new Set<string>();
  const result: GeoPoint[] = [];
  for (const p of points) {
    const key = `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(p);
    }
  }
  return result;
}
