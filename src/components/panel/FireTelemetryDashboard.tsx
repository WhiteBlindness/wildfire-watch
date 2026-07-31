"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FireTelemetry, FireTelemetryPoint } from "@/lib/wildfire/types";
import { formatThousands } from "@/lib/wildfire/format";
import { useLocale } from "@/lib/i18n/LocaleProvider";

interface FireTelemetryDashboardProps {
  telemetry: FireTelemetry;
}

const TIME_LOCALE: Record<"en" | "pt", string> = { en: "en-GB", pt: "pt-PT" };

export default function FireTelemetryDashboard({ telemetry }: FireTelemetryDashboardProps) {
  const { locale, t } = useLocale();
  const data = telemetry.points.map((point) => ({
    ...point,
    time: new Date(point.timestamp).toLocaleTimeString(TIME_LOCALE[locale], { hour: "2-digit", minute: "2-digit" }),
  }));

  return (
    <section className="border-y border-border/40 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{t.fireDetail.telemetryDashboardTitle}</h3>
        {telemetry.simulated && (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-amber-300">
            {t.fireDetail.simulatedLabel}
          </span>
        )}
      </div>

      <ChartSection title={t.fireDetail.fireProgressionTitle}>
        <div className="w-full">
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={data} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="telemetry-area-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="currentColor" strokeOpacity={0.1} vertical={false} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: "currentColor" }} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis tick={{ fontSize: 10, fill: "currentColor" }} tickLine={false} axisLine={false} width={42} />
              <Tooltip content={<TelemetryTooltip type="progression" />} cursor={{ stroke: "rgba(239, 68, 68, 0.35)", strokeWidth: 1 }} />
              <Area type="monotone" dataKey="areaBurned" stroke="#ef4444" fill="url(#telemetry-area-fill)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </ChartSection>

      <ChartSection title={t.fireDetail.resourceAllocationTitle} className="mt-4">
        <div className="w-full">
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={data} margin={{ top: 6, right: 6, left: -16, bottom: 0 }} barGap={2}>
              <CartesianGrid stroke="currentColor" strokeOpacity={0.1} vertical={false} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: "currentColor" }} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis tick={{ fontSize: 10, fill: "currentColor" }} tickLine={false} axisLine={false} width={42} />
              <Tooltip content={<TelemetryTooltip type="resources" />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Bar dataKey="groundUnits" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={18} />
              <Bar dataKey="aerialUnits" fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartSection>

      <p className="mt-3 text-xs leading-5 text-foreground/60">{t.fireDetail.simulatedTelemetryNote}</p>
    </section>
  );
}

function ChartSection({ children, className = "", title }: { children: React.ReactNode; className?: string; title: string }) {
  return (
    <div className={className}>
      <p className="mb-2 text-xs font-medium text-foreground/80">{title}</p>
      {children}
    </div>
  );
}

interface TelemetryTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: FireTelemetryPoint & { time: string } }>;
  type: "progression" | "resources";
}

function TelemetryTooltip({ active, payload, type }: TelemetryTooltipProps) {
  const { t } = useLocale();
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="min-w-40 rounded-lg border border-border/60 bg-surface/95 px-3 py-2 text-xs text-foreground shadow-lg backdrop-blur-xl">
      {type === "progression" ? (
        <>
          <p className="font-semibold text-foreground">{t.fireDetail.fireProgressionTitle}</p>
          <p className="mt-1 text-foreground/70">{point.time}</p>
          <p className="text-foreground/70">{t.fireDetail.affectedAreaLabel}: <span className="font-medium text-red-400">{formatThousands(point.areaBurned)} ha</span></p>
          <p className="text-foreground/70">{t.fireDetail.frpLabel}: <span className="font-medium text-amber-300">{point.frpTrend.toFixed(1)} MW</span></p>
        </>
      ) : (
        <>
          <p className="font-semibold text-foreground">{t.fireDetail.resourceAllocationTitle}</p>
          <p className="mt-1 text-foreground/70">{point.time}</p>
          <p className="text-foreground/70">{t.fireDetail.groundUnitsLabel}: <span className="font-medium text-amber-300">{formatThousands(point.groundUnits)}</span></p>
          <p className="text-foreground/70">{t.fireDetail.aerialUnitsLabel}: <span className="font-medium text-red-400">{point.aerialUnits}</span></p>
        </>
      )}
    </div>
  );
}
