"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WildfireEvent } from "@/lib/wildfire/types";
import { formatThousands } from "@/lib/wildfire/format";
import { useLocale } from "@/lib/i18n/LocaleProvider";

interface FireIntensityChartProps {
  events: WildfireEvent[];
  onSelect: (id: string) => void;
}

const TOP_N = 6;
const LABEL_MAX_CHARS = 18;
const NOMINATIM_INTERVAL_MS = 1_100;
const locationCache = new Map<string, Promise<string | null>>();
let geocodingQueue: Promise<void> = Promise.resolve();

function truncate(label: string): string {
  return label.length > LABEL_MAX_CHARS ? `${label.slice(0, LABEL_MAX_CHARS - 1)}…` : label;
}

interface ChartRow {
  id: string;
  fullLabel: string;
  shortLabel: string;
  frp: number;
  detections: number;
}

export default function FireIntensityChart({ events, onSelect }: FireIntensityChartProps) {
  const { locale, t } = useLocale();
  const [locationLabels, setLocationLabels] = useState<Record<string, string>>({});
  const topEvents = useMemo(
    () => events
      .filter((event): event is WildfireEvent & { maxFrpMw: number } => event.maxFrpMw != null)
      .sort((a, b) => b.maxFrpMw - a.maxFrpMw)
      .slice(0, TOP_N),
    [events],
  );

  useEffect(() => {
    let cancelled = false;

    Promise.all(topEvents.map(async (event) => {
      const label = await reverseGeocode(event, locale);
      if (!cancelled && label) {
        setLocationLabels((current) => current[event.id] === label
          ? current
          : { ...current, [event.id]: label });
      }
    })).catch(() => {
      // Rows retain a readable region/country fallback on lookup failure.
    });

    return () => {
      cancelled = true;
    };
  }, [locale, topEvents]);

  const rows = useMemo<ChartRow[]>(
    () => topEvents.map((event) => {
      const fallback = event.country.includes("unmatched")
        ? t.intensityChart.locating
        : event.region === event.country ? event.country : `${event.region}, ${event.country}`;
      const label = locationLabels[event.id] ?? fallback;
      return {
        id: event.id,
        fullLabel: label,
        shortLabel: truncate(label),
        frp: Math.round(event.maxFrpMw),
        detections: event.heatmapPoints.length,
      };
    }),
    [locationLabels, t.intensityChart.locating, topEvents],
  );

  if (rows.length === 0) {
    return <p className="text-xs text-foreground/50">{t.intensityChart.empty}</p>;
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/50">
        {t.intensityChart.title}
      </h3>
      <div className="h-56 w-full bg-transparent">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 36 }}>
            <defs>
              <linearGradient id="intensityBarFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fbbf24" />
                <stop offset="100%" stopColor="#f43f5e" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#334155" strokeOpacity={0.4} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="shortLabel"
              tick={{ fontSize: 9, fill: "#94a3b8" }}
              tickLine={false}
              axisLine={false}
              angle={-35}
              textAnchor="end"
              interval={0}
              height={54}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickLine={false}
              axisLine={false}
              width={40}
              label={{ value: t.intensityChart.yAxisLabel, angle: -90, position: "insideLeft", fontSize: 10, fill: "#94a3b8" }}
            />
            <Tooltip
              cursor={{ fill: "rgba(148, 163, 184, 0.08)" }}
              content={(props) => <IntensityTooltip {...props} t={t} />}
            />
            <Bar
              dataKey="frp"
              fill="url(#intensityBarFill)"
              radius={[4, 4, 0, 0]}
              maxBarSize={36}
              cursor="pointer"
              onClick={(data) => {
                const row = (data as { payload?: ChartRow })?.payload;
                if (row) onSelect(row.id);
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ul className="flex flex-wrap gap-1.5">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onSelect(row.id)}
              className="sr-only min-h-11 min-w-11 rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-rose-500"
            >
              {row.fullLabel} — {formatThousands(row.frp)} MW
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[11px] text-foreground/35">
        {t.intensityChart.geocodingAttribution}{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 min-w-11 items-center rounded-md px-2 underline decoration-foreground/20 underline-offset-2 transition-colors hover:text-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70"
        >
          OpenStreetMap
        </a>
      </p>
    </div>
  );
}

function reverseGeocode(event: WildfireEvent, locale: "en" | "pt"): Promise<string | null> {
  const cacheKey = `${event.location.lat.toFixed(4)},${event.location.lng.toFixed(4)},${locale}`;
  const cached = locationCache.get(cacheKey);
  if (cached) return cached;

  const request = geocodingQueue.then(async () => {
    try {
      const params = new URLSearchParams({
        lat: String(event.location.lat),
        lon: String(event.location.lng),
        locale,
      });
      const response = await fetch(`/api/reverse-geocode?${params}`);
      if (!response.ok) return null;
      const payload = await response.json() as { label?: string };
      return typeof payload.label === "string" ? payload.label : null;
    } finally {
      await new Promise((resolve) => window.setTimeout(resolve, NOMINATIM_INTERVAL_MS));
    }
  });
  geocodingQueue = request.then(() => undefined, () => undefined);
  locationCache.set(cacheKey, request);
  void request.then((label) => {
    if (!label) locationCache.delete(cacheKey);
  });
  return request;
}

interface IntensityTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ChartRow }>;
  t: ReturnType<typeof useLocale>["t"];
}

function IntensityTooltip({ active, payload, t }: IntensityTooltipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 shadow-[0_12px_32px_rgba(0,0,0,0.32)]">
      <p className="font-semibold">{row.fullLabel}</p>
      <p className="text-slate-400">
        {t.intensityChart.tooltipFrpLabel}: <span className="text-rose-400">{formatThousands(row.frp)} MW</span>
      </p>
      <p className="text-slate-400">
        {t.intensityChart.tooltipDetectionsLabel}: {formatThousands(row.detections)}
      </p>
    </div>
  );
}
