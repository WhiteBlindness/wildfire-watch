"use client";

import { useEffect, useMemo, useState } from "react";
import type { FireWeather, WildfireEvent } from "@/lib/wildfire/types";
import { formatThousands } from "@/lib/wildfire/format";
import { estimateBurnedAreaHectares } from "@/lib/wildfire/fire-estimation";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import FireTelemetryDashboard from "./FireTelemetryDashboard";
import AdSlot from "@/components/ui/AdSlot";

interface FireDetailsPanelProps {
  event: WildfireEvent;
  onClose: () => void;
}

const DATE_LOCALE: Record<"en" | "pt", string> = { en: "en-GB", pt: "pt-PT" };

export default function FireDetailsPanel({ event, onClose }: FireDetailsPanelProps) {
  const { locale, t } = useLocale();
  const [weather, setWeather] = useState<FireWeather | null>(null);
  const [weatherFailed, setWeatherFailed] = useState(false);
  const estimatedAreaHectares = useMemo(
    () => event.satelliteDetection
      ? estimateBurnedAreaHectares(event.satelliteDetection.frpMw, event.startedAt)
      : event.areaHectares,
    [event],
  );

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      latitude: String(event.location.lat),
      longitude: String(event.location.lng),
      current: [
        "temperature_2m",
        "relative_humidity_2m",
        "precipitation",
        "precipitation_probability",
        "wind_speed_10m",
        "wind_direction_10m",
        "wind_gusts_10m",
      ].join(","),
      wind_speed_unit: "kmh",
    });

    fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Open-Meteo request failed: ${response.status}`);
        return response.json() as Promise<OpenMeteoResponse>;
      })
      .then((payload) => {
        const current = payload.current;
        if (
          !current
          || !Number.isFinite(current.temperature_2m)
          || !Number.isFinite(current.wind_speed_10m)
          || !Number.isFinite(current.wind_direction_10m)
          || !Number.isFinite(current.wind_gusts_10m)
          || !Number.isFinite(current.relative_humidity_2m)
          || !Number.isFinite(current.precipitation)
          || !Number.isFinite(current.precipitation_probability)
        ) {
          throw new Error("Open-Meteo returned incomplete current weather");
        }
        setWeather({
          temperatureC: current.temperature_2m,
          windSpeedKmh: current.wind_speed_10m,
          windDirectionDeg: current.wind_direction_10m,
          windGustKmh: current.wind_gusts_10m,
          relativeHumidityPct: current.relative_humidity_2m,
          precipitationMm: current.precipitation,
          precipitationProbabilityPct: current.precipitation_probability,
          observedAt: current.time,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Unable to load point weather", error);
        setWeatherFailed(true);
      });

    return () => controller.abort();
  }, [event.location.lat, event.location.lng]);

  function formatDateTime(iso: string): string {
    // DD/MM/YYYY regardless of language: en-GB and pt-PT both order day-first,
    // avoiding the en-US MM/DD ambiguity while still translating the chrome.
    return new Date(iso).toLocaleString(DATE_LOCALE[locale], {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-5">
      <button
        type="button"
        onClick={onClose}
        className="-mx-2 -my-2 flex min-h-11 items-center gap-1.5 self-start rounded-lg px-2 py-2 text-xs font-medium text-foreground/55 transition-[color,background-color,transform] duration-200 hover:bg-surface-muted/60 hover:text-foreground active:translate-x-[-2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t.fireDetail.backToGlobalMap}
      </button>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold leading-snug tracking-[-0.02em] text-foreground">{event.name}</h2>
          <p className="mt-1 text-sm text-foreground/55">
            {event.region === event.country ? event.country : `${event.region}, ${event.country}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.fireDetail.closeLabel}
          className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-muted/55 text-foreground/55 ring-1 ring-inset ring-border/70 transition-[color,background-color,transform] duration-200 hover:bg-surface-muted hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Stat
          label={t.fireDetail.areaLabel}
          value={`${event.satelliteDetection ? "≈ " : ""}${formatThousands(estimatedAreaHectares)} ha`}
          hint={event.satelliteDetection ? t.fireDetail.estimatedAreaNote : undefined}
        />
        <Stat label={t.fireDetail.startLabel} value={formatDateTime(event.startedAt)} />
      </dl>

      {event.satelliteDetection && (
        <div className="rounded-xl bg-red-500/8 p-3.5 ring-1 ring-inset ring-red-500/25">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-300/80">
            {t.fireDetail.satelliteTelemetryTitle}
          </h3>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Stat label={t.fireDetail.coordinatesLabel} value={`${event.location.lat.toFixed(4)}, ${event.location.lng.toFixed(4)}`} />
            <Stat label={t.fireDetail.frpLabel} value={`${event.satelliteDetection.frpMw.toFixed(1)} MW`} />
            <Stat label={t.fireDetail.confidenceLabel} value={`${Math.round(event.satelliteDetection.confidencePct)}%`} />
            <Stat label={t.fireDetail.detectedAtLabel} value={formatDateTime(event.satelliteDetection.detectedAt)} />
          </dl>
          <p className="mt-3 text-xs leading-5 text-foreground/60">{t.fireDetail.referencePerimeterNote}</p>
        </div>
      )}

      <FireTelemetryDashboard weather={weather} weatherFailed={weatherFailed} />

      <div className="mt-auto pt-2">
        <AdSlot variant="panel-rectangle" />
      </div>
    </div>
  );
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m: number;
    relative_humidity_2m: number;
    precipitation: number;
    precipitation_probability: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    wind_gusts_10m: number;
    time: string;
  };
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-foreground/45">{label}</dt>
      <dd className="mt-1 break-words font-mono text-xs font-medium tabular-nums text-foreground">{value}</dd>
      {hint && <dd className="mt-1 text-[11px] leading-4 text-foreground/45">{hint}</dd>}
    </div>
  );
}
