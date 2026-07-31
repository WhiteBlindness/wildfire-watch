"use client";

import type { ReactNode } from "react";
import { CloudRain, Compass, Droplets, Gauge, Thermometer, Wind } from "lucide-react";
import type { FireWeather } from "@/lib/wildfire/types";
import { useLocale } from "@/lib/i18n/LocaleProvider";

interface FireTelemetryDashboardProps {
  weather: FireWeather | null;
  weatherFailed: boolean;
}

export default function FireTelemetryDashboard({ weather, weatherFailed }: FireTelemetryDashboardProps) {
  const { t } = useLocale();

  return (
    <section className="rounded-2xl border border-border/60 bg-surface-muted/35 p-3.5 shadow-[0_18px_48px_rgba(0,0,0,0.18)] backdrop-blur-xl sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-[-0.015em] text-foreground">
          {t.fireDetail.liveConditionsTitle}
        </h3>
        {!weatherFailed && (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/55">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.7)] motion-safe:animate-pulse" />
            {t.fireDetail.liveLabel}
          </span>
        )}
      </div>

      {weather ? (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border/45">
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
        <div className="flex min-h-28 items-center justify-center rounded-xl bg-background/25 px-3 text-center text-xs text-foreground/55 ring-1 ring-inset ring-border/45">
          {weatherFailed ? t.fireDetail.weatherUnavailable : t.fireDetail.weatherLoading}
        </div>
      )}

      <p className="mt-2.5 text-[11px] uppercase tracking-[0.08em] text-foreground/35">
        {t.fireDetail.openMeteoSource}
      </p>
    </section>
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
