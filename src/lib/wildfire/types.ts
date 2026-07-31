// Normalized internal schema. Every data source (mock, NASA FIRMS, EFFIS, local
// civil protection feeds) must be mapped into this shape before it reaches the UI,
// so map/panel/chart components never know or care where the data came from.

export type FireSeverity = "low" | "moderate" | "high" | "extreme";
export type FireStatus = "active" | "contained" | "extinguished";

export interface GeoPoint {
  lng: number;
  lat: number;
}

/** A single satellite hotspot detection (FIRMS-style). */
export interface HeatmapPoint extends GeoPoint {
  /** Relative brightness/intensity, 0-1, drives heatmap weight. */
  intensity: number;
  /** Detection timestamp, ISO 8601. */
  detectedAt: string;
}

/** Telemetry emitted with one satellite thermal-anomaly detection. */
export interface SatelliteDetection {
  /** Fire Radiative Power measured by the sensor, in megawatts. */
  frpMw: number;
  /** Provider-normalized confidence, 0-100. */
  confidencePct: number;
  /** Satellite acquisition time, ISO 8601. */
  detectedAt: string;
}

/** Burned-area / fire-front polygon, outer ring only, [lng, lat] pairs, closed ring. */
export type FirePolygon = GeoPoint[];

export interface WindConditions {
  speedKmh: number;
  /** Compass bearing the wind blows TOWARD, 0-359. */
  directionDeg: number;
  gustKmh?: number;
}

export interface DeployedForces {
  firefighters: number;
  vehicles: number;
  aircraft: {
    planes: number;
    helicopters: number;
  };
}

export interface InternationalAid {
  requested: boolean;
  active: boolean;
  countries: string[];
}

/** One sample in the fire's time-series evolution (for charts). */
export interface FireEvolutionPoint {
  timestamp: string;
  areaHectares: number;
  personnel: number;
}

export interface WildfireEvent {
  id: string;
  name: string;
  country: string;
  region: string;
  location: GeoPoint;

  status: FireStatus;
  severity: FireSeverity;

  startedAt: string;
  estimatedContainmentAt: string | null;
  containedAt: string | null;

  areaHectares: number;
  polygon: FirePolygon | null;
  heatmapPoints: HeatmapPoint[];

  /** Operational detail. Real satellite-hotspot sources (FIRMS) have none of
   * this — a fire's wind, deployed forces, aid status, and growth history are
   * not observable from thermal detections alone. Null means "not available
   * from this source," never a fabricated placeholder. The UI must render
   * accordingly rather than invent numbers to fill the gap. */
  wind: WindConditions | null;
  forces: DeployedForces | null;
  internationalAid: InternationalAid | null;
  evolution: FireEvolutionPoint[] | null;

  /** Peak Fire Radiative Power (MW) across this cluster's detections — a real
   * physical measurement satellite sources provide. Null for sources (mock)
   * that have no such sensor reading. */
  maxFrpMw: number | null;

  /** Present only when this record represents one measured thermal anomaly. */
  satelliteDetection: SatelliteDetection | null;

  /** Which upstream feed produced this record. */
  source: "mock" | "firms" | "effis" | "civil-protection";
  lastUpdated: string;
}

/** Contract every real/mock data provider must implement. UI code only ever
 * talks to this interface, never to a concrete provider. */
export interface WildfireDataAdapter {
  /** Cheap list for the map: all currently known events. */
  listEvents(): Promise<WildfireEvent[]>;
  /** Full detail for a single event (side panel). May be the same object
   * `listEvents` already returned, or a richer fetch for real adapters. */
  getEvent(id: string): Promise<WildfireEvent | null>;
}
