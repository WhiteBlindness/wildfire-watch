"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import {
  CloudRain,
  Compass,
  Droplets,
  Flame,
  Gauge,
  Plane,
  Thermometer,
  Users,
  Wind,
} from "lucide-react";
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
import type { FireTelemetry, FireTelemetryPoint, FireWeather } from "@/lib/wildfire/types";
import { formatThousands } from "@/lib/wildfire/format";
import { useLocale } from "@/lib/i18n/LocaleProvider";

interface FireTelemetryDashboardProps {
  telemetry: FireTelemetry;
  weather: FireWeather | null;
  weatherFailed: boolean;
}

const TIME_LOCALE: Record<"en" | "pt", string> = { en: "en-GB", pt: "pt-PT" };

export default function FireTelemetryDashboard({ telemetry, weather, weatherFailed }: FireTelemetryDashboardProps) {
  const { locale, t } = useLocale();
  const telemetryPoints = Array.isArray(telemetry.points) ? telemetry.points : [];
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, telemetryPoints.length - 1));
  const safeIndex = Math.min(selectedIndex, Math.max(0, telemetryPoints.length - 1));
  const selectedPoint = telemetryPoints[safeIndex] ?? null;
  const timelineProgress = telemetryPoints.length > 1 ? (safeIndex / (telemetryPoints.length - 1)) * 100 : 100;
  const data = telemetryPoints.map((point) => ({
    ...point,
    time: new Date(point.timestamp).toLocaleTimeString(TIME_LOCALE[locale], { hour: "2-digit", minute: "2-digit" }),
  }));
  const visibleData = data.slice(0, safeIndex + 1);

  return (
    <section className="rounded-2xl border border-border/60 bg-surface-muted/35 p-3.5 shadow-[0_18px_48px_rgba(0,0,0,0.18)] backdrop-blur-xl sm:p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-[-0.015em] text-foreground">
          {t.fireDetail.telemetryDashboardTitle}
        </h3>
        {telemetry.simulated && (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-300">
            {t.fireDetail.simulatedLabel}
          </span>
        )}
      </div>

      <EnvironmentGrid weather={weather} weatherFailed={weatherFailed} />

      {selectedPoint ? (
        <>
          <div className="mt-5 border-t border-border/50 pt-4" data-timeline-index={safeIndex}>
            <div className="flex items-end justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-foreground">{t.fireDetail.timelineTitle}</h4>
                <p className="mt-0.5 text-xs text-foreground/50">{t.fireDetail.timelineHint}</p>
              </div>
              <time className="shrink-0 font-mono text-[11px] font-medium tabular-nums text-red-300" dateTime={selectedPoint.timestamp}>
                {formatTimelineLabel(selectedPoint.timestamp, locale)}
              </time>
            </div>

            <input
              type="range"
              min={0}
              max={telemetryPoints.length - 1}
              step={1}
              value={safeIndex}
              onChange={(event) => setSelectedIndex(Number(event.currentTarget.value))}
              aria-label={t.fireDetail.timelineAriaLabel}
              aria-valuetext={formatTimelineLabel(selectedPoint.timestamp, locale)}
              className="telemetry-range mt-3 h-11 w-full text-foreground focus-visible:outline-none"
              style={{ "--timeline-progress": `${timelineProgress}%` } as CSSProperties}
            />

            <div className="-mt-1 flex justify-between font-mono text-[11px] tabular-nums text-foreground/35" aria-hidden="true">
              <span>{formatTimelineLabel(telemetryPoints[0].timestamp, locale)}</span>
              <span>{formatTimelineLabel(telemetryPoints.at(-1)?.timestamp ?? selectedPoint.timestamp, locale)}</span>
            </div>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 border-y border-border/40 py-3">
            <TimelineMetric icon={<Flame aria-hidden="true" />} label={t.fireDetail.affectedAreaLabel} value={`${formatThousands(selectedPoint.areaBurned)} ha`} />
            <TimelineMetric icon={<Gauge aria-hidden="true" />} label={t.fireDetail.frpLabel} value={`${selectedPoint.frpTrend.toFixed(1)} MW`} />
            <TimelineMetric icon={<Users aria-hidden="true" />} label={t.fireDetail.groundUnitsLabel} value={formatThousands(selectedPoint.groundUnits)} />
            <TimelineMetric icon={<Plane aria-hidden="true" />} label={t.fireDetail.aerialUnitsLabel} value={String(selectedPoint.aerialUnits)} />
          </dl>

          <ChartSection title={t.fireDetail.fireProgressionTitle} className="mt-4">
            <div className="relative h-[150px] min-h-[150px] w-full">
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={visibleData} margin={{ top: 8, right: 6, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="telemetry-area-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="currentColor" strokeOpacity={0.08} vertical={false} />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: "currentColor" }} tickLine={false} axisLine={false} minTickGap={28} />
                  <YAxis tick={{ fontSize: 10, fill: "currentColor" }} tickLine={false} axisLine={false} width={42} />
                  <Tooltip content={<TelemetryTooltip type="progression" />} cursor={{ stroke: "rgba(239, 68, 68, 0.35)", strokeWidth: 1 }} />
                  <Area type="monotone" dataKey="areaBurned" stroke="#ef4444" fill="url(#telemetry-area-fill)" strokeWidth={2} animationDuration={220} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </ChartSection>

          <ChartSection title={t.fireDetail.resourceAllocationTitle} className="mt-4">
            <div className="relative h-[150px] min-h-[150px] w-full">
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={visibleData} margin={{ top: 8, right: 6, left: -16, bottom: 0 }} barGap={2}>
                  <CartesianGrid stroke="currentColor" strokeOpacity={0.08} vertical={false} />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: "currentColor" }} tickLine={false} axisLine={false} minTickGap={28} />
                  <YAxis tick={{ fontSize: 10, fill: "currentColor" }} tickLine={false} axisLine={false} width={42} />
                  <Tooltip content={<TelemetryTooltip type="resources" />} cursor={{ fill: "rgba(255,255,255,0.035)" }} />
                  <Bar dataKey="groundUnits" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={18} animationDuration={220} />
                  <Bar dataKey="aerialUnits" fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={18} animationDuration={220} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartSection>
        </>
      ) : (
        <p className="mt-4 rounded-xl bg-background/25 px-3 py-4 text-xs text-foreground/55">
          {t.fireDetail.telemetryUnavailable}
        </p>
      )}

      <p className="mt-4 text-[11px] leading-5 text-foreground/50">{t.fireDetail.simulatedTelemetryNote}</p>
    </section>
  );
}

function EnvironmentGrid({ weather, weatherFailed }: { weather: FireWeather | null; weatherFailed: boolean }) {
  const { t } = useLocale();

  return (
    <div className="rounded-xl bg-background/25 p-3 ring-1 ring-inset ring-border/45">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-foreground">{t.fireDetail.environmentTitle}</h4>
        {!weatherFailed && (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/55">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.7)] motion-safe:animate-pulse" />
            {t.fireDetail.liveLabel}
          </span>
        )}
      </div>

      {weather ? (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border/45">
          <WeatherStat icon={<Thermometer aria-hidden="true" />} label={t.fireDetail.temperatureLabel} value={`${weather.temperatureC.toFixed(1)}°C`} />
          <WeatherStat icon={<Wind aria-hidden="true" />} label={t.fireDetail.windSpeedLabel} value={`${weather.windSpeedKmh.toFixed(1)} km/h`} />
          <WeatherStat icon={<Compass aria-hidden="true" />} label={t.fireDetail.windDirectionLabel} value={`${Math.round(weather.windDirectionDeg)}°`} />
          <WeatherStat icon={<Gauge aria-hidden="true" />} label={t.fireDetail.windGustLabel} value={`${weather.windGustKmh.toFixed(1)} km/h`} />
          <WeatherStat icon={<Droplets aria-hidden="true" />} label={t.fireDetail.humidityLabel} value={`${Math.round(weather.relativeHumidityPct)}%`} />
          <WeatherStat
            icon={<CloudRain aria-hidden="true" />}
            label={t.fireDetail.precipitationProbabilityLabel}
            value={`${Math.round(weather.precipitationProbabilityPct)}%`}
            detail={`${weather.precipitationMm.toFixed(1)} mm`}
          />
        </dl>
      ) : (
        <div className="flex min-h-24 items-center justify-center px-3 text-center text-xs text-foreground/55">
          {weatherFailed ? t.fireDetail.weatherUnavailable : t.fireDetail.weatherLoading}
        </div>
      )}

      <p className="mt-2.5 text-[11px] uppercase tracking-[0.08em] text-foreground/35">{t.fireDetail.openMeteoSource}</p>
    </div>
  );
}

function WeatherStat({ detail, icon, label, value }: { detail?: string; icon: ReactNode; label: string; value: string }) {
  return (
    <div className="min-h-24 bg-surface/90 p-2.5">
      <div className="flex items-center gap-1.5 text-foreground/45 [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:stroke-[1.7]">
        {icon}
        <dt className="text-[11px] font-semibold uppercase leading-tight tracking-[0.06em]">{label}</dt>
      </div>
      <dd className="mt-2 font-mono text-sm font-semibold tabular-nums text-foreground">
        {value}
        {detail && <span className="ml-1.5 text-[11px] font-normal text-foreground/40">{detail}</span>}
      </dd>
    </div>
  );
}

function TimelineMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-foreground/40 [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:stroke-[1.7]">
        {icon}
        <dt className="text-[11px] font-semibold uppercase leading-tight tracking-[0.06em]">{label}</dt>
      </div>
      <dd className="mt-1 font-mono text-xs font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function formatTimelineLabel(timestamp: string, locale: "en" | "pt"): string {
  return new Date(timestamp).toLocaleString(TIME_LOCALE[locale], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ChartSection({ children, className = "", title }: { children: ReactNode; className?: string; title: string }) {
  return (
    <div className={className}>
      <p className="mb-2 text-[11px] font-semibold text-foreground/70">{title}</p>
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
    <div className="min-w-40 rounded-xl bg-surface/95 px-3 py-2.5 text-xs text-foreground shadow-[0_12px_32px_rgba(0,0,0,0.32)] ring-1 ring-inset ring-border/60 backdrop-blur-xl">
      <p className="font-semibold text-foreground">
        {type === "progression" ? t.fireDetail.fireProgressionTitle : t.fireDetail.resourceAllocationTitle}
      </p>
      <p className="mt-1 font-mono text-[11px] text-foreground/50">{point.time}</p>
      {type === "progression" ? (
        <>
          <p className="mt-1 text-foreground/65">{t.fireDetail.affectedAreaLabel}: <span className="font-medium text-red-400">{formatThousands(point.areaBurned)} ha</span></p>
          <p className="text-foreground/65">{t.fireDetail.frpLabel}: <span className="font-medium text-amber-300">{point.frpTrend.toFixed(1)} MW</span></p>
        </>
      ) : (
        <>
          <p className="mt-1 text-foreground/65">{t.fireDetail.groundUnitsLabel}: <span className="font-medium text-amber-300">{formatThousands(point.groundUnits)}</span></p>
          <p className="text-foreground/65">{t.fireDetail.aerialUnitsLabel}: <span className="font-medium text-red-400">{point.aerialUnits}</span></p>
        </>
      )}
    </div>
  );
}
