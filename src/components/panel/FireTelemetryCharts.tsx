"use client";

import { useId } from "react";
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FireTelemetryPoint } from "@/lib/wildfire/types";
import { useLocale } from "@/lib/i18n/LocaleProvider";

interface FireTelemetryChartsProps {
  points: FireTelemetryPoint[];
}

const TIME_LOCALE: Record<"en" | "pt", string> = { en: "en-GB", pt: "pt-PT" };

export default function FireTelemetryCharts({ points }: FireTelemetryChartsProps) {
  const { locale } = useLocale();
  const gradientId = `fire-area-${useId().replace(/:/g, "")}`;
  const labels = locale === "pt"
    ? {
        evolution: "Evolu\u00e7\u00e3o do inc\u00eandio",
        evolutionSubtitle: "\u00c1rea ardida e pot\u00eancia radiativa",
        area: "\u00c1rea ardida (ha)",
        frp: "Pot\u00eancia radiativa (MW)",
        resources: "Aloca\u00e7\u00e3o de recursos",
        resourcesSubtitle: "Efetivos e meios a\u00e9reos mobilizados",
        ground: "Bombeiros",
        aerial: "Aeronaves",
        simulated: "Proje\u00e7\u00e3o simulada a partir da telemetria FIRMS",
      }
    : {
        evolution: "Fire evolution",
        evolutionSubtitle: "Burned area and radiative power",
        area: "Burned area (ha)",
        frp: "Radiative power (MW)",
        resources: "Resource allocation",
        resourcesSubtitle: "Firefighters and aircraft deployed",
        ground: "Firefighters",
        aerial: "Aircraft",
        simulated: "Simulated projection derived from FIRMS telemetry",
      };
  const chartData = points.map((point) => ({
    ...point,
    time: new Date(point.timestamp).toLocaleTimeString(TIME_LOCALE[locale], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));
  const tooltipStyle = {
    backgroundColor: "#0b0f14",
    border: "1px solid rgba(148, 163, 184, 0.28)",
    borderRadius: "10px",
    boxShadow: "0 16px 36px rgba(0, 0, 0, 0.42)",
    color: "#f8fafc",
    fontFamily: "var(--font-geist-mono)",
    fontSize: "11px",
  };

  return (
    <>
      <section className="rounded-2xl border border-border/60 bg-surface-muted/35 p-3.5 shadow-[0_18px_48px_rgba(0,0,0,0.18)] backdrop-blur-xl sm:p-4">
        <div className="mb-2.5">
          <h3 className="text-sm font-semibold tracking-[-0.015em] text-foreground">{labels.evolution}</h3>
          <p className="mt-0.5 text-[11px] text-foreground/45">{labels.evolutionSubtitle}</p>
        </div>
        <div className="relative h-[150px] min-h-[150px] w-full">
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={chartData} margin={{ top: 8, right: 6, left: -22, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.62} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tick={{ fontSize: 9, fill: "rgba(226,232,240,0.5)" }} tickLine={false} axisLine={false} minTickGap={20} />
              <YAxis tick={{ fontSize: 9, fill: "rgba(226,232,240,0.45)" }} tickLine={false} axisLine={false} width={44} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#94a3b8" }} />
              <Area type="monotone" dataKey="areaBurned" name={labels.area} stroke="#ef4444" fill={`url(#${gradientId})`} strokeWidth={2} />
              <Area type="monotone" dataKey="frpTrend" name={labels.frp} stroke="#f59e0b" fill="transparent" strokeWidth={1.5} strokeDasharray="4 3" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[10px] uppercase tracking-[0.07em] text-foreground/35">{labels.simulated}</p>
      </section>

      <section className="rounded-2xl border border-border/60 bg-surface-muted/35 p-3.5 shadow-[0_18px_48px_rgba(0,0,0,0.18)] backdrop-blur-xl sm:p-4">
        <div className="mb-2.5">
          <h3 className="text-sm font-semibold tracking-[-0.015em] text-foreground">{labels.resources}</h3>
          <p className="mt-0.5 text-[11px] text-foreground/45">{labels.resourcesSubtitle}</p>
        </div>
        <div className="relative h-[150px] min-h-[150px] w-full">
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={chartData} margin={{ top: 8, right: 6, left: -22, bottom: 0 }}>
              <XAxis dataKey="time" tick={{ fontSize: 9, fill: "rgba(226,232,240,0.5)" }} tickLine={false} axisLine={false} minTickGap={20} />
              <YAxis tick={{ fontSize: 9, fill: "rgba(226,232,240,0.45)" }} tickLine={false} axisLine={false} width={44} />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: "rgba(148, 163, 184, 0.08)" }}
                labelStyle={{ color: "#94a3b8" }}
              />
              <Bar dataKey="groundUnits" name={labels.ground} fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={14} />
              <Bar dataKey="aerialUnits" name={labels.aerial} fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[10px] uppercase tracking-[0.07em] text-foreground/35">{labels.simulated}</p>
      </section>
    </>
  );
}
