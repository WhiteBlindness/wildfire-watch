import { mulberry32, pick, seededInt, seededRange } from "./random";
import type {
  DeployedForces,
  FireEvolutionPoint,
  FirePolygon,
  FireSeverity,
  FireStatus,
  HeatmapPoint,
  WildfireEvent,
} from "./types";

interface FireSeed {
  id: string;
  name: string;
  country: string;
  region: string;
  lat: number;
  lng: number;
  /** Rough max radius in km once fully grown; drives polygon + area scale. */
  maxRadiusKm: number;
  status: FireStatus;
  severity: FireSeverity;
  /** Hours ago the fire started. */
  startedHoursAgo: number;
  /** Hours ago it was contained, if status is contained/extinguished. */
  containedHoursAgo?: number;
}

// Real-world wildfire-prone regions, biased toward Portugal/Iberia per the
// product's primary market, plus known global hotspots for a "global" feel.
const FIRE_SEEDS: FireSeed[] = [
  { id: "pt-pedrogao", name: "Incêndio de Pedrógão Grande", country: "Portugal", region: "Leiria", lat: 39.917, lng: -8.15, maxRadiusKm: 14, status: "active", severity: "extreme", startedHoursAgo: 30 },
  { id: "pt-covilha", name: "Incêndio da Serra da Estrela", country: "Portugal", region: "Covilhã", lat: 40.33, lng: -7.61, maxRadiusKm: 9, status: "active", severity: "high", startedHoursAgo: 18 },
  { id: "pt-monchique", name: "Incêndio de Monchique", country: "Portugal", region: "Algarve", lat: 37.32, lng: -8.55, maxRadiusKm: 5, status: "contained", severity: "moderate", startedHoursAgo: 60, containedHoursAgo: 6 },
  { id: "es-galicia", name: "Incendio de Galicia", country: "Espanha", region: "Ourense", lat: 42.34, lng: -7.86, maxRadiusKm: 11, status: "active", severity: "high", startedHoursAgo: 22 },
  { id: "gr-evia", name: "Πυρκαγιά Εύβοιας", country: "Grécia", region: "Eubeia", lat: 38.73, lng: 23.6, maxRadiusKm: 16, status: "active", severity: "extreme", startedHoursAgo: 40 },
  { id: "fr-cotedazur", name: "Incendie de la Côte d'Azur", country: "França", region: "Var", lat: 43.27, lng: 6.64, maxRadiusKm: 4, status: "contained", severity: "low", startedHoursAgo: 50, containedHoursAgo: 14 },
  { id: "it-sicilia", name: "Incendio della Sicilia", country: "Itália", region: "Palermo", lat: 37.9, lng: 13.7, maxRadiusKm: 7, status: "extinguished", severity: "moderate", startedHoursAgo: 96, containedHoursAgo: 48 },
  { id: "us-california", name: "California Complex Fire", country: "Estados Unidos", region: "Califórnia", lat: 38.6, lng: -120.9, maxRadiusKm: 25, status: "active", severity: "extreme", startedHoursAgo: 70 },
  { id: "ca-alberta", name: "Alberta Wildfire", country: "Canadá", region: "Alberta", lat: 54.5, lng: -113.4, maxRadiusKm: 30, status: "active", severity: "extreme", startedHoursAgo: 120 },
  { id: "au-nsw", name: "New South Wales Bushfire", country: "Austrália", region: "Nova Gales do Sul", lat: -33.6, lng: 150.3, maxRadiusKm: 20, status: "active", severity: "high", startedHoursAgo: 55 },
  { id: "za-capetown", name: "Cape Town Wildfire", country: "África do Sul", region: "Cidade do Cabo", lat: -34.0, lng: 18.45, maxRadiusKm: 6, status: "contained", severity: "moderate", startedHoursAgo: 40, containedHoursAgo: 8 },
  { id: "br-amazonia", name: "Incêndio da Amazónia", country: "Brasil", region: "Mato Grosso", lat: -11.2, lng: -58.4, maxRadiusKm: 22, status: "active", severity: "high", startedHoursAgo: 85 },
  { id: "tr-antalya", name: "Antalya Orman Yangını", country: "Turquia", region: "Antália", lat: 36.9, lng: 30.7, maxRadiusKm: 8, status: "active", severity: "moderate", startedHoursAgo: 12 },
  { id: "id-kalimantan", name: "Kebakaran Hutan Kalimantan", country: "Indonésia", region: "Kalimantan", lat: -1.6, lng: 113.4, maxRadiusKm: 18, status: "active", severity: "high", startedHoursAgo: 100 },
];

const AID_COUNTRIES = ["Espanha", "França", "Marrocos", "Itália", "Alemanha", "EUA"];

function kmToDegLat(km: number): number {
  return km / 111;
}
function kmToDegLng(km: number, atLat: number): number {
  return km / (111 * Math.cos((atLat * Math.PI) / 180));
}

function severityProgress(status: FireStatus): number {
  // How "grown" the fire is, 0-1, used to scale polygon/area/heatpoints.
  if (status === "active") return 0.55;
  if (status === "contained") return 0.85;
  return 1;
}

function buildPolygon(
  rand: () => number,
  centerLat: number,
  centerLng: number,
  radiusKm: number,
): FirePolygon {
  const points = 10 + seededInt(rand, 0, 4);
  const ring: FirePolygon = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const jitter = seededRange(rand, 0.55, 1.05);
    const r = radiusKm * jitter;
    const dLat = kmToDegLat(r) * Math.sin(angle);
    const dLng = kmToDegLng(r, centerLat) * Math.cos(angle);
    ring.push({ lat: centerLat + dLat, lng: centerLng + dLng });
  }
  ring.push(ring[0]);
  return ring;
}

function buildHeatmapPoints(
  rand: () => number,
  centerLat: number,
  centerLng: number,
  radiusKm: number,
  startedAt: Date,
  count: number,
): HeatmapPoint[] {
  const points: HeatmapPoint[] = [];
  for (let i = 0; i < count; i++) {
    const angle = seededRange(rand, 0, Math.PI * 2);
    const r = radiusKm * Math.sqrt(seededRange(rand, 0, 1));
    const dLat = kmToDegLat(r) * Math.sin(angle);
    const dLng = kmToDegLng(r, centerLat) * Math.cos(angle);
    const detected = new Date(
      startedAt.getTime() + seededRange(rand, 0, 1) * (Date.now() - startedAt.getTime()),
    );
    points.push({
      lat: centerLat + dLat,
      lng: centerLng + dLng,
      intensity: seededRange(rand, 0.3, 1),
      detectedAt: detected.toISOString(),
    });
  }
  return points;
}

function buildForces(rand: () => number, severity: FireSeverity, areaHectares: number): DeployedForces {
  const scaleBySeverity: Record<FireSeverity, number> = { low: 0.4, moderate: 0.8, high: 1.4, extreme: 2.2 };
  const scale = scaleBySeverity[severity];
  const base = Math.max(20, Math.sqrt(areaHectares)) * scale;
  return {
    firefighters: Math.round(base * seededRange(rand, 3, 5)),
    vehicles: Math.round(base * seededRange(rand, 0.6, 1.1)),
    aircraft: {
      planes: seededInt(rand, 0, severity === "extreme" ? 8 : severity === "high" ? 5 : 2),
      helicopters: seededInt(rand, 1, severity === "extreme" ? 10 : severity === "high" ? 6 : 3),
    },
  };
}

function buildEvolution(
  rand: () => number,
  startedAt: Date,
  now: Date,
  finalAreaHectares: number,
  status: FireStatus,
  finalForces: number,
): FireEvolutionPoint[] {
  const totalMs = now.getTime() - startedAt.getTime();
  const samples = Math.min(24, Math.max(6, Math.round(totalMs / (1000 * 60 * 60 * 2))));
  const points: FireEvolutionPoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    // Logistic-ish growth curve: fast rise then plateau, contained fires flatten earlier.
    const plateauAt = status === "active" ? 0.9 : 0.55;
    const growth = t >= plateauAt ? 1 : 1 / (1 + Math.exp(-10 * (t - plateauAt * 0.55)));
    const noise = seededRange(rand, 0.97, 1.03);
    points.push({
      timestamp: new Date(startedAt.getTime() + t * totalMs).toISOString(),
      areaHectares: Math.round(finalAreaHectares * Math.min(1, growth) * noise),
      personnel: Math.round(finalForces * Math.min(1, growth * 1.05) * noise),
    });
  }
  return points;
}

function toEvent(seed: FireSeed, index: number): WildfireEvent {
  const rand = mulberry32(0x9e3779b9 ^ (index * 2654435761));
  const now = new Date();
  const startedAt = new Date(now.getTime() - seed.startedHoursAgo * 3600_000);
  const containedAt =
    seed.containedHoursAgo != null ? new Date(now.getTime() - seed.containedHoursAgo * 3600_000) : null;

  const progress = severityProgress(seed.status);
  const radiusKm = seed.maxRadiusKm * progress;
  const areaHectares = Math.round(Math.PI * radiusKm * radiusKm * 100 * seededRange(rand, 0.4, 0.7));

  const polygon = buildPolygon(rand, seed.lat, seed.lng, radiusKm);
  const heatmapCount = Math.max(15, Math.round(radiusKm * 6));
  const heatmapPoints = buildHeatmapPoints(rand, seed.lat, seed.lng, radiusKm, startedAt, heatmapCount);
  const forces = buildForces(rand, seed.severity, areaHectares);

  const evolution = buildEvolution(
    rand,
    startedAt,
    now,
    areaHectares,
    seed.status,
    forces.firefighters,
  );

  const needsAid = seed.severity === "extreme" && seed.status === "active";
  return {
    id: seed.id,
    name: seed.name,
    country: seed.country,
    region: seed.region,
    location: { lat: seed.lat, lng: seed.lng },
    status: seed.status,
    severity: seed.severity,
    startedAt: startedAt.toISOString(),
    estimatedContainmentAt:
      seed.status === "active"
        ? new Date(now.getTime() + seededRange(rand, 6, 72) * 3600_000).toISOString()
        : null,
    containedAt: containedAt ? containedAt.toISOString() : null,
    areaHectares,
    polygon,
    heatmapPoints,
    wind: {
      speedKmh: Math.round(seededRange(rand, 5, 55)),
      directionDeg: seededInt(rand, 0, 359),
      gustKmh: Math.round(seededRange(rand, 20, 80)),
    },
    forces,
    internationalAid: {
      requested: needsAid,
      active: needsAid && rand() > 0.3,
      countries: needsAid ? shuffle(rand, AID_COUNTRIES).slice(0, seededInt(rand, 1, 3)) : [],
    },
    evolution,
    maxFrpMw: null,
    satelliteDetection: null,
    source: "mock",
    lastUpdated: now.toISOString(),
  };
}

function shuffle<T>(rand: () => number, items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

let cached: WildfireEvent[] | null = null;

/** Deterministic mock dataset, generated once per process/module load. */
export function generateMockEvents(): WildfireEvent[] {
  if (cached) return cached;
  cached = FIRE_SEEDS.map(toEvent);
  return cached;
}

export { pick };
