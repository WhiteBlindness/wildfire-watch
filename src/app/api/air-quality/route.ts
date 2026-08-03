export const dynamic = "force-dynamic";

const OPENAQ_BASE_URL = "https://api.openaq.org/v3";
const PM25_PARAMETER_ID = 2;
const OPENAQ_RADIUS_LIMIT_METERS = 25_000;
const SEARCH_RADIUS_METERS = 100_000;
const MAX_CANDIDATE_LOCATIONS = 4;
const UPSTREAM_TIMEOUT_MS = 7_000;

type AirQualityCategory = "good" | "moderate" | "unhealthy-sensitive" | "unhealthy" | "very-unhealthy" | "hazardous";

interface OpenAqLocation {
  id?: number;
  name?: string | null;
  locality?: string | null;
  coordinates?: {
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  sensors?: Array<{
    id?: number;
    parameter?: { id?: number; name?: string; units?: string };
  }>;
}

interface OpenAqLatestMeasurement {
  value?: number;
  datetime?: { utc?: string };
  sensorsId?: number;
}

interface LocationCandidate {
  id: number;
  name: string | null;
  distanceKm: number;
  pm25SensorIds: Set<number>;
  unit: string;
}

interface Pm25Reading {
  pm25: number;
  aqi: number;
  category: AirQualityCategory;
  observedAt: string;
  stationName: string | null;
  distanceKm: number;
  unit: string;
  source: "OpenAQ";
  aqiMethod: "US EPA PM2.5 breakpoint estimate";
}

function finiteCoordinate(value: string | null, min: number, max: number): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export function pm25ToAqi(pm25: number): { aqi: number; category: AirQualityCategory } {
  const concentration = Math.floor(pm25 * 10) / 10;
  const bands: Array<[number, number, number, number, AirQualityCategory]> = [
    [0, 12, 0, 50, "good"],
    [12.1, 35.4, 51, 100, "moderate"],
    [35.5, 55.4, 101, 150, "unhealthy-sensitive"],
    [55.5, 150.4, 151, 200, "unhealthy"],
    [150.5, 250.4, 201, 300, "very-unhealthy"],
    [250.5, 350.4, 301, 400, "hazardous"],
    [350.5, 500.4, 401, 500, "hazardous"],
  ];
  const band = bands.find((candidate) => concentration <= candidate[1]) ?? bands.at(-1)!;
  const [concentrationLow, concentrationHigh, indexLow, indexHigh, category] = band;
  const aqi = Math.round(((indexHigh - indexLow) / (concentrationHigh - concentrationLow)) * (concentration - concentrationLow) + indexLow);
  return { aqi: clamp(aqi, 0, 500), category };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toRadians(value: number): number {
  return value * Math.PI / 180;
}

export function distanceBetweenKm(latA: number, lonA: number, latB: number, lonB: number): number {
  const earthRadiusKm = 6_371;
  const latitudeDelta = toRadians(latB - latA);
  const longitudeDelta = toRadians(lonB - lonA);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

function searchBoundingBoxes(lat: number, lon: number): string[] {
  const radiusKm = SEARCH_RADIUS_METERS / 1_000;
  const latitudeDelta = radiusKm / 111.32;
  const longitudeScale = Math.max(0.01, Math.cos(toRadians(lat)));
  const longitudeDelta = Math.min(180, radiusKm / (111.32 * longitudeScale));
  const south = clamp(lat - latitudeDelta, -90, 90);
  const north = clamp(lat + latitudeDelta, -90, 90);

  if (longitudeDelta >= 180) return [`-180,${south},180,${north}`];

  const west = lon - longitudeDelta;
  const east = lon + longitudeDelta;
  if (west < -180) {
    return [
      `${west + 360},${south},180,${north}`,
      `-180,${south},${east},${north}`,
    ];
  }
  if (east > 180) {
    return [
      `${west},${south},180,${north}`,
      `-180,${south},${east - 360},${north}`,
    ];
  }
  return [`${west},${south},${east},${north}`];
}

async function openAqFetch<T>(path: string, apiKey: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(`${OPENAQ_BASE_URL}${path}`, {
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OpenAQ request failed: ${response.status}`);
    return response.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

function toCandidates(locations: OpenAqLocation[], lat: number, lon: number): LocationCandidate[] {
  return locations.flatMap((location) => {
    const locationLat = location.coordinates?.latitude;
    const locationLon = location.coordinates?.longitude;
    if (!Number.isFinite(location.id) || !Number.isFinite(locationLat) || !Number.isFinite(locationLon)) return [];

    const pm25Sensors = (location.sensors ?? []).filter(
      (sensor) => sensor.parameter?.id === PM25_PARAMETER_ID || sensor.parameter?.name?.toLowerCase() === "pm25",
    );
    const pm25SensorIds = new Set(pm25Sensors.map((sensor) => sensor.id).filter((id): id is number => Number.isFinite(id)));
    if (pm25SensorIds.size === 0) return [];

    const distanceKm = distanceBetweenKm(lat, lon, locationLat!, locationLon!);
    if (distanceKm > SEARCH_RADIUS_METERS / 1_000) return [];

    return [{
      id: location.id!,
      name: location.name ?? location.locality ?? null,
      distanceKm,
      pm25SensorIds,
      unit: pm25Sensors.find((sensor) => sensor.parameter?.units)?.parameter?.units ?? "µg/m³",
    }];
  }).sort((a, b) => a.distanceKm - b.distanceKm);
}

async function findCandidateLocations(lat: number, lon: number, apiKey: string): Promise<LocationCandidate[]> {
  const nearbyParams = new URLSearchParams({
    coordinates: `${lat.toFixed(4)},${lon.toFixed(4)}`,
    radius: String(OPENAQ_RADIUS_LIMIT_METERS),
    parameters_id: String(PM25_PARAMETER_ID),
    limit: "1000",
    page: "1",
  });
  const nearby = await openAqFetch<{ results?: OpenAqLocation[] }>(`/locations?${nearbyParams}`, apiKey);

  const expandedResults = await Promise.allSettled(searchBoundingBoxes(lat, lon).map((bbox) => {
    const params = new URLSearchParams({
      bbox,
      parameters_id: String(PM25_PARAMETER_ID),
      limit: "1000",
      page: "1",
    });
    return openAqFetch<{ results?: OpenAqLocation[] }>(`/locations?${params}`, apiKey);
  }));
  const expandedResponses = expandedResults
    .filter((result): result is PromiseFulfilledResult<{ results?: OpenAqLocation[] }> => result.status === "fulfilled")
    .map((result) => result.value);
  if ((nearby.results ?? []).length === 0 && expandedResponses.length === 0) {
    throw new Error("OpenAQ expanded-location search failed");
  }
  const uniqueLocations = new Map<number, OpenAqLocation>();
  for (const location of [
    ...(nearby.results ?? []),
    ...expandedResponses.flatMap((response) => response.results ?? []),
  ]) {
    if (Number.isFinite(location.id)) uniqueLocations.set(location.id!, location);
  }
  return toCandidates([...uniqueLocations.values()], lat, lon);
}

async function getCandidateReading(candidate: LocationCandidate, apiKey: string): Promise<Pm25Reading | null> {
  const params = new URLSearchParams({ limit: "100", page: "1" });
  const payload = await openAqFetch<{ results?: OpenAqLatestMeasurement[] }>(
    `/locations/${candidate.id}/latest?${params}`,
    apiKey,
  );
  const latest = (payload.results ?? [])
    .filter((measurement) => Number.isFinite(measurement.value)
      && measurement.value! >= 0
      && Number.isFinite(measurement.sensorsId)
      && candidate.pm25SensorIds.has(measurement.sensorsId!))
    .sort((a, b) => Date.parse(b.datetime?.utc ?? "") - Date.parse(a.datetime?.utc ?? ""))[0];

  if (!latest || latest.value === undefined) return null;
  const { aqi, category } = pm25ToAqi(latest.value);
  return {
    pm25: latest.value,
    aqi,
    category,
    observedAt: latest.datetime?.utc ?? new Date().toISOString(),
    stationName: candidate.name,
    distanceKm: Math.round(candidate.distanceKm * 10) / 10,
    unit: candidate.unit,
    source: "OpenAQ",
    aqiMethod: "US EPA PM2.5 breakpoint estimate",
  };
}

export async function findNearestPm25Reading(lat: number, lon: number, apiKey: string): Promise<Pm25Reading | null> {
  const candidates = await findCandidateLocations(lat, lon, apiKey);
  if (candidates.length === 0) return null;

  const readings = await Promise.allSettled(
    candidates.slice(0, MAX_CANDIDATE_LOCATIONS).map((candidate) => getCandidateReading(candidate, apiKey)),
  );
  const reading = readings
    .filter((result): result is PromiseFulfilledResult<Pm25Reading | null> => result.status === "fulfilled")
    .map((result) => result.value)
    .find((result): result is Pm25Reading => result !== null);
  if (reading) return reading;
  if (readings.every((result) => result.status === "rejected")) throw new Error("All OpenAQ latest-reading requests failed");
  return null;
}

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const lat = finiteCoordinate(requestUrl.searchParams.get("lat"), -90, 90);
  const lon = finiteCoordinate(requestUrl.searchParams.get("lon"), -180, 180);
  if (lat === null || lon === null) return Response.json({ error: "Invalid coordinates" }, { status: 400 });

  const apiKey = process.env.OPENAQ_API_KEY;
  if (!apiKey) {
    return Response.json(
      { reading: null, availability: "unconfigured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const reading = await findNearestPm25Reading(lat, lon, apiKey);
    return Response.json(
      { reading, availability: reading ? "available" : "no-nearby-monitor", searchRadiusKm: SEARCH_RADIUS_METERS / 1_000 },
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600" } },
    );
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`OpenAQ lookup failed (${reason})`);
    return Response.json(
      { error: "Air quality unavailable", availability: "upstream-error" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
