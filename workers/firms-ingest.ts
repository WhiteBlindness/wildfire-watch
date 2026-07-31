import { FIRMS_CACHE_KEY, type CachedFirmsPoint, type FirmsCachePayload } from "../src/lib/wildfire/firms-cache";

const FIRMS_BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const FIRMS_SOURCE = "VIIRS_SNPP_NRT";
const FIRMS_DAY_RANGE = 1;
const MAX_POINTS = 6_000;

interface Env {
  FIRMS_CACHE: FirmsKvNamespace;
  FIRMS_MAP_KEY: string;
}

interface FirmsKvNamespace {
  get(key: string): Promise<string | null>;
  get<T>(key: string, type: "json"): Promise<T | null>;
  put(key: string, value: string): Promise<void>;
}

interface ParsedRow {
  lat: number;
  lng: number;
  frpMw: number;
  confidencePct: number;
  detectedAt: string;
}

function parseConfidence(raw: string): number {
  const value = raw.trim().toLowerCase();
  if (value === "l" || value === "low") return 30;
  if (value === "n" || value === "nominal") return 65;
  if (value === "h" || value === "high") return 90;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toTimestamp(date: string, time: string): string | null {
  if (!date) return null;
  const hhmm = time.trim().padStart(4, "0");
  const parsed = new Date(`${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseCsv(csv: string): { sourceRows: number; rows: ParsedRow[] } {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return { sourceRows: 0, rows: [] };

  const header = lines[0].split(",").map((cell) => cell.trim().toLowerCase());
  const indexOf = (name: string) => header.indexOf(name);
  const latIndex = indexOf("latitude");
  const lngIndex = indexOf("longitude");
  const frpIndex = indexOf("frp");
  const confidenceIndex = indexOf("confidence");
  const dateIndex = indexOf("acq_date");
  const timeIndex = indexOf("acq_time");
  if (latIndex < 0 || lngIndex < 0 || dateIndex < 0 || timeIndex < 0) {
    throw new Error("NASA FIRMS CSV is missing required columns");
  }

  const rows: ParsedRow[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const cells = lines[index].split(",");
    if (cells.length < header.length) continue;

    const lat = Number(cells[latIndex]);
    const lng = Number(cells[lngIndex]);
    const frpMw = frpIndex >= 0 ? Number(cells[frpIndex]) : 0;
    const confidencePct = confidenceIndex >= 0 ? parseConfidence(cells[confidenceIndex]) : 65;
    const detectedAt = toTimestamp(cells[dateIndex].trim(), cells[timeIndex]);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(frpMw)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    if (confidencePct < 50 || frpMw <= 0 || !detectedAt) continue;
    rows.push({ lat, lng, frpMw, confidencePct, detectedAt });
  }

  return { sourceRows: lines.length - 1, rows };
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function toPoint(row: ParsedRow): CachedFirmsPoint {
  const fingerprint = `${row.detectedAt}|${row.lat.toFixed(4)}|${row.lng.toFixed(4)}`;
  return {
    id: `firms-${hash(fingerprint).toString(36)}`,
    lat: Math.round(row.lat * 10_000) / 10_000,
    lng: Math.round(row.lng * 10_000) / 10_000,
    frpMw: Math.round(row.frpMw * 10) / 10,
    confidencePct: Math.round(row.confidencePct),
    detectedAt: row.detectedAt,
  };
}

function selectPoints(rows: ParsedRow[]): CachedFirmsPoint[] {
  const unique = new Map<string, CachedFirmsPoint>();
  for (const row of rows) {
    const point = toPoint(row);
    unique.set(point.id, point);
  }
  const points = [...unique.values()];
  if (points.length <= MAX_POINTS) return points;

  // Deterministic sampling keeps global coverage without combining nearby
  // detections: every retained item is still one original FIRMS anomaly.
  return points
    .map((point) => ({ point, score: hash(point.id) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_POINTS)
    .map(({ point }) => point);
}

async function refreshCache(env: Env): Promise<FirmsCachePayload> {
  if (!env.FIRMS_MAP_KEY) throw new Error("FIRMS_MAP_KEY is not configured");
  const response = await fetch(
    `${FIRMS_BASE_URL}/${env.FIRMS_MAP_KEY}/${FIRMS_SOURCE}/world/${FIRMS_DAY_RANGE}`,
    { headers: { Accept: "text/csv" } },
  );
  if (!response.ok) throw new Error(`NASA FIRMS request failed: ${response.status}`);

  const parsed = parseCsv(await response.text());
  const points = selectPoints(parsed.rows);
  if (points.length === 0) throw new Error("NASA FIRMS returned no qualifying hotspots");

  const payload: FirmsCachePayload = {
    version: 1,
    source: "NASA FIRMS VIIRS_SNPP_NRT",
    generatedAt: new Date().toISOString(),
    sourceRows: parsed.sourceRows,
    filteredRows: parsed.rows.length,
    points,
  };
  await env.FIRMS_CACHE.put(FIRMS_CACHE_KEY, JSON.stringify(payload));
  console.log("FIRMS cache refreshed", {
    generatedAt: payload.generatedAt,
    sourceRows: payload.sourceRows,
    filteredRows: payload.filteredRows,
    cachedPoints: payload.points.length,
  });
  return payload;
}

const firmsIngestWorker = {
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await refreshCache(env);
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      const cached = await env.FIRMS_CACHE.get<FirmsCachePayload>(FIRMS_CACHE_KEY, "json");
      return Response.json({
        ok: Boolean(cached?.points.length),
        generatedAt: cached?.generatedAt ?? null,
        count: cached?.points.length ?? 0,
      });
    }
    if (request.method === "POST" && url.pathname === "/refresh") {
      if (request.headers.get("x-firms-refresh-key") !== env.FIRMS_MAP_KEY) {
        return new Response("Unauthorized", { status: 401 });
      }
      const payload = await refreshCache(env);
      return Response.json({ ok: true, generatedAt: payload.generatedAt, count: payload.points.length });
    }
    return new Response("Not found", { status: 404 });
  },
};

export default firmsIngestWorker;
