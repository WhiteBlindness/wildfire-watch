import type { GeoPoint } from "@/lib/wildfire/types";

/**
 * Current conditions from the Open-Meteo forecast model at a detection's
 * coordinates. These are model values for a grid cell, not observations at
 * the fire, and the interface labels them that way.
 *
 * The request is made from the visitor's browser on purpose: Open-Meteo's free
 * tier limits requests per IP address, and a Cloudflare Worker would share its
 * egress addresses (and so its quota) with unrelated tenants. The browser only
 * sends the detection's coordinates, never anything about the visitor.
 */
export interface ModelledWeather {
  temperatureC: number;
  windSpeedKmh: number;
  /** Direction the wind blows FROM, degrees (meteorological convention). */
  windDirectionDeg: number;
  windGustKmh: number;
  relativeHumidityPct: number;
  precipitationMm: number;
  precipitationProbabilityPct: number;
  /** Model time step the values belong to, ISO 8601 (UTC). */
  validAt: string;
  provider: "Open-Meteo";
}

const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const CURRENT_VARIABLES = [
  "temperature_2m",
  "relative_humidity_2m",
  "precipitation",
  "precipitation_probability",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
] as const;
export const WEATHER_TIMEOUT_MS = 8_000;

/** Coordinates are rounded to ~1 km: finer precision adds nothing to a model grid cell. */
export function buildOpenMeteoUrl(location: GeoPoint): string {
  const params = new URLSearchParams({
    latitude: location.lat.toFixed(2),
    longitude: location.lng.toFixed(2),
    current: CURRENT_VARIABLES.join(","),
    wind_speed_unit: "kmh",
    timezone: "GMT",
  });
  return `${OPEN_METEO_ENDPOINT}?${params}`;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Validates the provider response; returns null when any value is missing or malformed. */
export function parseOpenMeteoCurrent(payload: unknown): ModelledWeather | null {
  if (!payload || typeof payload !== "object") return null;
  const current = (payload as { current?: Record<string, unknown> }).current;
  if (!current || typeof current !== "object") return null;
  if (!CURRENT_VARIABLES.every((variable) => finite(current[variable]))) return null;
  // Open-Meteo returns local-time strings without an offset; with timezone=GMT they are UTC.
  const time = typeof current.time === "string" ? `${current.time}${current.time.endsWith("Z") ? "" : "Z"}` : "";
  if (!Number.isFinite(Date.parse(time))) return null;

  return {
    temperatureC: current.temperature_2m as number,
    windSpeedKmh: current.wind_speed_10m as number,
    windDirectionDeg: current.wind_direction_10m as number,
    windGustKmh: current.wind_gusts_10m as number,
    relativeHumidityPct: current.relative_humidity_2m as number,
    precipitationMm: current.precipitation as number,
    precipitationProbabilityPct: current.precipitation_probability as number,
    validAt: new Date(time).toISOString(),
    provider: "Open-Meteo",
  };
}

export async function fetchModelledWeather(location: GeoPoint, signal: AbortSignal): Promise<ModelledWeather> {
  const timeout = AbortSignal.timeout(WEATHER_TIMEOUT_MS);
  const combined = typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeout]) : signal;
  const response = await fetch(buildOpenMeteoUrl(location), { signal: combined });
  if (!response.ok) throw new Error(`Open-Meteo request failed: ${response.status}`);
  const weather = parseOpenMeteoCurrent(await response.json());
  if (!weather) throw new Error("Open-Meteo returned incomplete current conditions");
  return weather;
}
