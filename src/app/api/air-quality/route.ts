export const dynamic = "force-dynamic";

const OPENAQ_BASE_URL = "https://api.openaq.org/v3";
const PM25_PARAMETER_ID = 2;
const MAX_RADIUS_METERS = 25_000;

type AirQualityCategory = "good" | "moderate" | "unhealthy-sensitive" | "unhealthy" | "very-unhealthy" | "hazardous";

interface OpenAqLocation {
  id?: number;
  name?: string | null;
  locality?: string | null;
  distance?: number | null;
  sensors?: Array<{
    id?: number;
    parameter?: { id?: number; name?: string };
  }>;
}

interface OpenAqSensor {
  id?: number;
  parameter?: { id?: number; name?: string; units?: string };
  latest?: {
    value?: number;
    datetime?: { utc?: string };
  };
}

interface Pm25Reading {
  pm25: number;
  aqi: number;
  category: AirQualityCategory;
  observedAt: string;
  stationName: string | null;
  distanceKm: number | null;
  unit: "µg/m³";
  source: "OpenAQ";
  aqiMethod: "US EPA PM2.5 breakpoint estimate";
}

function finiteCoordinate(value: string | null, min: number, max: number): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function pm25ToAqi(pm25: number): { aqi: number; category: AirQualityCategory } {
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

async function openAqFetch<T>(path: string, apiKey: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_000);
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

async function findNearestPm25Reading(lat: number, lon: number, apiKey: string): Promise<Pm25Reading | null> {
  const locationParams = new URLSearchParams({
    coordinates: `${lat.toFixed(4)},${lon.toFixed(4)}`,
    radius: String(MAX_RADIUS_METERS),
    parameters_id: String(PM25_PARAMETER_ID),
    limit: "8",
    page: "1",
  });
  const locations = await openAqFetch<{ results?: OpenAqLocation[] }>(`/locations?${locationParams}`, apiKey);
  const candidates = (locations.results ?? [])
    .flatMap((location) => (location.sensors ?? [])
      .filter((sensor) => sensor.parameter?.id === PM25_PARAMETER_ID || sensor.parameter?.name === "pm25")
      .map((sensor) => ({ location, sensorId: sensor.id })))
    .filter((candidate): candidate is { location: OpenAqLocation; sensorId: number } => Number.isFinite(candidate.sensorId));

  for (const candidate of candidates.slice(0, 5)) {
    const payload = await openAqFetch<{ results?: OpenAqSensor[] }>(`/sensors/${candidate.sensorId}`, apiKey);
    const sensor = payload.results?.[0];
    const pm25 = sensor?.latest?.value;
    if (!Number.isFinite(pm25) || pm25 === undefined || pm25 < 0 || sensor?.parameter?.units !== "µg/m³") continue;
    const { aqi, category } = pm25ToAqi(pm25);
    return {
      pm25,
      aqi,
      category,
      observedAt: sensor.latest?.datetime?.utc ?? new Date().toISOString(),
      stationName: candidate.location.name ?? candidate.location.locality ?? null,
      distanceKm: Number.isFinite(candidate.location.distance) ? Math.round((candidate.location.distance ?? 0) / 100) / 10 : null,
      unit: "µg/m³",
      source: "OpenAQ",
      aqiMethod: "US EPA PM2.5 breakpoint estimate",
    };
  }

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
      { reading, availability: reading ? "available" : "no-nearby-monitor" },
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600" } },
    );
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`OpenAQ lookup failed (${reason})`);
    return Response.json({ error: "Air quality unavailable" }, { status: 502 });
  }
}
