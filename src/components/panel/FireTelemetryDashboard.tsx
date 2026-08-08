"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { CloudRain, Compass, Droplets, ExternalLink, Gauge, LoaderCircle, Newspaper, RotateCw, Thermometer, Wind } from "lucide-react";
import type { FireWeather } from "@/lib/wildfire/types";
import { useLocale } from "@/lib/i18n/LocaleProvider";

interface FireTelemetryDashboardProps {
  coordinates: { lat: number; lng: number };
  weather: FireWeather | null;
  locationName: string | null;
  region: string;
  country: string;
  publishedAfter: string;
  selectionId: string;
  weatherFailed: boolean;
}

interface NewsArticle {
  title: string;
  link: string;
  publishedAt: string;
}

interface NewsResult {
  key: string;
  articles: NewsArticle[];
  failed: boolean;
}

type AirQualityCategory = "good" | "moderate" | "unhealthy-sensitive" | "unhealthy" | "very-unhealthy" | "hazardous";

interface AirQualityReading {
  pm25: number;
  aqi: number;
  category: AirQualityCategory;
  observedAt: string;
  stationName: string | null;
  distanceKm: number | null;
  unit: string;
  source: "OpenAQ";
  aqiMethod: string;
}

type AqiError = "no-nearby-monitor" | "unavailable";

interface AirQualityResponse {
  reading?: AirQualityReading | null;
  availability?: "available" | "no-nearby-monitor" | "unconfigured" | "upstream-error";
}

export default function FireTelemetryDashboard({ coordinates, weather, weatherFailed, locationName, region, country, publishedAfter, selectionId }: FireTelemetryDashboardProps) {
  const { locale, t } = useLocale();
  const [newsResult, setNewsResult] = useState<NewsResult | null>(null);
  const [isFetchingAQI, setIsFetchingAQI] = useState(true);
  const [aqiData, setAqiData] = useState<AirQualityReading | null>(null);
  const [aqiError, setAqiError] = useState<AqiError | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [airQualityRetryNonce, setAirQualityRetryNonce] = useState(0);
  const requestKey = `${selectionId}:${locale}:${locationName ?? "pending"}:${region}:${country}:${publishedAfter}:${retryNonce}`;
  const hasCurrentResult = newsResult?.key === requestKey;
  const articles = hasCurrentResult ? newsResult.articles : [];
  const newsFailed = hasCurrentResult ? newsResult.failed : false;
  const newsLoading = Boolean(locationName && !hasCurrentResult);

  useEffect(() => {
    if (!locationName) return;

    const controller = new AbortController();
    const params = new URLSearchParams({
      location: locationName,
      region,
      country,
      publishedAfter,
      locale,
    });

    fetch(`/api/news?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`News request failed: ${response.status}`);
        return response.json() as Promise<{ articles?: NewsArticle[] }>;
      })
      .then((payload) => setNewsResult({
        key: requestKey,
        articles: Array.isArray(payload.articles) ? payload.articles : [],
        failed: false,
      }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Unable to load local wildfire news", error);
        setNewsResult({ key: requestKey, articles: [], failed: true });
      });

    return () => controller.abort();
  }, [country, locale, locationName, publishedAfter, region, requestKey]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ lat: String(coordinates.lat), lon: String(coordinates.lng) });

    fetch(`/api/air-quality?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as AirQualityResponse;
        if (!response.ok) throw new Error(`Air quality request failed: ${response.status} (${payload.availability ?? "unknown"})`);
        return payload;
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        if (payload.reading) {
          setAqiData(payload.reading);
          setAqiError(null);
        } else {
          setAqiData(null);
          setAqiError("no-nearby-monitor");
        }
        setIsFetchingAQI(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Unable to load local air quality", error);
        setAqiData(null);
        setAqiError("unavailable");
        setIsFetchingAQI(false);
      });

    return () => controller.abort();
  }, [airQualityRetryNonce, coordinates.lat, coordinates.lng, selectionId]);

  function retryAirQuality(): void {
    setIsFetchingAQI(true);
    setAqiData(null);
    setAqiError(null);
    setAirQualityRetryNonce((value) => value + 1);
  }

  return (
    <div className="space-y-4">
      <section
        data-testid="air-quality-section"
        aria-busy={isFetchingAQI}
        aria-labelledby="air-quality-title"
        className="rounded-2xl border border-border/60 bg-surface-muted/35 p-3.5 shadow-[0_18px_48px_rgba(0,0,0,0.18)] backdrop-blur-xl sm:p-4"
      >
        <div className="mb-3 flex items-center gap-2">
          <Wind aria-hidden="true" className="h-4 w-4 text-red-400" />
          <h3 id="air-quality-title" className="text-sm font-semibold tracking-[-0.015em] text-foreground">{t.fireDetail.airQualityTitle}</h3>
        </div>

        {isFetchingAQI ? (
          <AirQualityLoadingState />
        ) : aqiData ? (
          <AirQualityReadingCard reading={aqiData} />
        ) : (
          <AirQualityUnavailableState
            message={aqiError === "no-nearby-monitor" ? t.fireDetail.airQualityNoMonitor : t.fireDetail.airQualityUnavailable}
            onRetry={aqiError === "unavailable" ? retryAirQuality : undefined}
          />
        )}

        <p className="mt-2.5 text-[11px] uppercase tracking-[0.08em] text-foreground/35">{t.fireDetail.airQualitySource}</p>
      </section>

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

      <section className="rounded-2xl border border-border/60 bg-surface-muted/35 p-3.5 shadow-[0_18px_48px_rgba(0,0,0,0.18)] backdrop-blur-xl sm:p-4">
        <div className="mb-3 flex items-center gap-2">
          <Newspaper aria-hidden="true" className="h-4 w-4 text-red-400" />
          <h3 className="text-sm font-semibold tracking-[-0.015em] text-foreground">{t.fireDetail.latestNewsTitle}</h3>
        </div>

        {!locationName ? (
          <NewsMessage>{t.fireDetail.newsAwaitingLocation}</NewsMessage>
        ) : newsLoading ? (
          <NewsMessage>{t.fireDetail.newsLoading}</NewsMessage>
        ) : newsFailed ? (
          <div className="rounded-xl bg-background/25 p-3 text-xs text-foreground/60 ring-1 ring-inset ring-border/45">
            <p>{t.fireDetail.newsUnavailable}</p>
            <button
              type="button"
              onClick={() => setRetryNonce((value) => value + 1)}
              className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg px-3 font-semibold text-foreground ring-1 ring-inset ring-border/70 transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70"
            >
              <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
              {t.fireDetail.newsRetry}
            </button>
          </div>
        ) : articles.length === 0 ? (
          <div>
            <NewsMessage>{t.fireDetail.newsEmpty}</NewsMessage>
            <p className="mt-2 text-[11px] leading-4 text-foreground/45">{t.fireDetail.newsCoverageSinceDetection}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {articles.map((article) => (
              <li key={article.link}>
                <a
                  href={article.link}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${article.title}. ${t.fireDetail.newsOpenLabel}`}
                  className="group flex min-h-11 items-start justify-between gap-3 rounded-xl bg-background/25 p-3 ring-1 ring-inset ring-border/45 transition-colors hover:bg-surface-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70"
                >
                  <span className="min-w-0">
                    <span className="line-clamp-2 block text-xs font-medium leading-5 text-foreground/85">{article.title}</span>
                    <time dateTime={article.publishedAt} className="mt-1 block font-mono text-[11px] uppercase tracking-[0.06em] text-foreground/40">{new Date(article.publishedAt).toLocaleDateString(locale === "pt" ? "pt-PT" : "en-GB")}</time>
                  </span>
                  <ExternalLink aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/35 transition-colors group-hover:text-red-400" />
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2.5 text-[11px] uppercase tracking-[0.08em] text-foreground/35">{t.fireDetail.newsSource}</p>
      </section>
    </div>
  );
}

function AirQualityLoadingState() {
  const { t } = useLocale();

  return (
    <div
      data-testid="air-quality-loading"
      role="status"
      aria-live="polite"
      className="min-h-28 rounded-xl bg-neutral-100/80 p-3.5 ring-1 ring-inset ring-neutral-200 dark:bg-neutral-950/35 dark:ring-neutral-800"
    >
      <div className="flex items-center gap-2.5 text-xs font-medium text-foreground/70">
        <LoaderCircle aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin text-red-400 motion-reduce:animate-none" />
        <span>{t.fireDetail.airQualityLoading}</span>
      </div>
      <div aria-hidden="true" className="mt-4 grid grid-cols-2 gap-3">
        <span className="h-10 animate-pulse rounded-lg bg-neutral-200/80 motion-reduce:animate-none dark:bg-neutral-800/75" />
        <span className="h-10 animate-pulse rounded-lg bg-neutral-200/80 motion-reduce:animate-none dark:bg-neutral-800/75" />
      </div>
    </div>
  );
}

function AirQualityUnavailableState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useLocale();

  return (
    <div
      data-testid="air-quality-fallback"
      aria-live="polite"
      className="min-h-24 rounded-xl bg-neutral-100/80 p-3.5 text-xs leading-5 text-neutral-600 ring-1 ring-inset ring-neutral-200 dark:bg-neutral-950/35 dark:text-neutral-400 dark:ring-neutral-800"
    >
      <p>{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg px-3 font-semibold text-foreground ring-1 ring-inset ring-border/70 transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70"
        >
          <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
          {t.fireDetail.airQualityRetry}
        </button>
      )}
    </div>
  );
}

function AirQualityReadingCard({ reading }: { reading: AirQualityReading }) {
  const { locale, t } = useLocale();
  const tone = {
    good: {
      surface: "bg-emerald-500/10 ring-emerald-400/30",
      text: "text-emerald-700 dark:text-emerald-300",
      dot: "bg-emerald-400",
      label: t.fireDetail.airQualityGood,
    },
    moderate: {
      surface: "bg-amber-500/10 ring-amber-400/30",
      text: "text-amber-700 dark:text-amber-300",
      dot: "bg-amber-400",
      label: t.fireDetail.airQualityModerate,
    },
    "unhealthy-sensitive": {
      surface: "bg-yellow-500/10 ring-yellow-400/30",
      text: "text-yellow-800 dark:text-yellow-300",
      dot: "bg-yellow-400",
      label: t.fireDetail.airQualitySensitive,
    },
    unhealthy: {
      surface: "bg-red-500/10 ring-red-400/30",
      text: "text-red-700 dark:text-red-300",
      dot: "bg-red-400",
      label: t.fireDetail.airQualityUnhealthy,
    },
    "very-unhealthy": {
      surface: "bg-violet-100/80 ring-violet-500/40 dark:bg-violet-950/45",
      text: "text-violet-800 dark:text-violet-200",
      dot: "bg-violet-500",
      label: t.fireDetail.airQualityVeryUnhealthy,
    },
    hazardous: {
      surface: "bg-purple-100/85 ring-purple-600/50 dark:bg-purple-950/60",
      text: "text-purple-900 dark:text-purple-100",
      dot: "bg-purple-500",
      label: t.fireDetail.airQualityHazardous,
    },
  }[reading.category];

  return (
    <div data-testid="air-quality-reading" aria-live="polite" className={`rounded-xl p-3 ring-1 ring-inset ${tone.surface}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/55">{t.fireDetail.aqiLabel}</p>
          <p className={`mt-1 font-mono text-3xl font-semibold leading-none tabular-nums ${tone.text}`}>{reading.aqi}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold ${tone.text}`}>
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
          {tone.label}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-neutral-200 pt-3 text-xs dark:border-neutral-800">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.07em] text-foreground/45">PM2.5</dt>
          <dd className="mt-1 font-mono font-semibold tabular-nums text-foreground">{reading.pm25.toFixed(1)} {reading.unit}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.07em] text-foreground/45">{t.fireDetail.airQualityStationLabel}</dt>
          <dd className="mt-1 truncate font-medium text-foreground/80">{reading.stationName ?? t.fireDetail.airQualityNearestMonitor}</dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] text-foreground/50">
        {reading.distanceKm === null ? t.fireDetail.airQualityDistanceUnknown : `${reading.distanceKm.toFixed(1)} km`} · {new Date(reading.observedAt).toLocaleString(locale === "pt" ? "pt-PT" : "en-GB")}
      </p>
    </div>
  );
}

function NewsMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-20 items-center justify-center rounded-xl bg-background/25 px-3 text-center text-xs text-foreground/55 ring-1 ring-inset ring-border/45">
      {children}
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
