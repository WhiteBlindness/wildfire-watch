"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WildfireEvent } from "@/lib/wildfire/types";
import { formatThousands } from "@/lib/wildfire/format";
import { useLocale } from "@/lib/i18n/LocaleProvider";

interface FireIntensityChartProps {
  events: WildfireEvent[];
  onSelect: (id: string) => void;
}

const TOP_N = 6;
const LABEL_MAX_CHARS = 12;

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
  const { t } = useLocale();

  const rows: ChartRow[] = useMemo(
    () =>
      events
        .filter((event): event is WildfireEvent & { maxFrpMw: number } => event.maxFrpMw != null)
        .sort((a, b) => b.maxFrpMw - a.maxFrpMw)
        .slice(0, TOP_N)
        .map((event) => {
          const label = event.country === "Localização aproximada"
            ? `${event.location.lat.toFixed(2)}, ${event.location.lng.toFixed(2)}`
            : event.country || event.region;
          return {
            id: event.id,
            fullLabel: label,
            shortLabel: truncate(label),
            frp: Math.round(event.maxFrpMw),
            detections: event.heatmapPoints.length,
          };
        }),
    [events],
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
          <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 24 }}>
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
              height={40}
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

      {/* Recharts bars have no native keyboard/focus support, so the chart
          alone leaves fire selection mouse-only. This list is the same
          data as real, tabbable buttons — invisible until a keyboard user
          reaches one, at which point it's fully visible with a focus ring. */}
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
    </div>
  );
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
    <div
      className="rounded-lg border px-3 py-2 text-xs"
      style={{ background: "#0f172a", borderColor: "#334155", color: "#e2e8f0" }}
    >
      <p className="font-semibold">{row.fullLabel}</p>
      <p style={{ color: "#94a3b8" }}>
        {t.intensityChart.tooltipFrpLabel}: <span className="text-rose-400">{formatThousands(row.frp)} MW</span>
      </p>
      <p style={{ color: "#94a3b8" }}>
        {t.intensityChart.tooltipDetectionsLabel}: {formatThousands(row.detections)}
      </p>
    </div>
  );
}
