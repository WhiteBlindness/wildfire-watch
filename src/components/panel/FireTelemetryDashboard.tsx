"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { CloudRain, Compass, Droplets, ExternalLink, Gauge, Newspaper, RotateCw, Thermometer, Wind } from "lucide-react";
import type { FireWeather } from "@/lib/wildfire/types";
import { useLocale } from "@/lib/i18n/LocaleProvider";

interface FireTelemetryDashboardProps {
  weather: FireWeather | null;
  locationName: string | null;
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

export default function FireTelemetryDashboard({ weather, weatherFailed, locationName, selectionId }: FireTelemetryDashboardProps) {
  const { locale, t } = useLocale();
  const [newsResult, setNewsResult] = useState<NewsResult | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const requestKey = `${selectionId}:${locale}:${locationName ?? "pending"}:${retryNonce}`;
  const hasCurrentResult = newsResult?.key === requestKey;
  const articles = hasCurrentResult ? newsResult.articles : [];
  const newsFailed = hasCurrentResult ? newsResult.failed : false;
  const newsLoading = Boolean(locationName && !hasCurrentResult);

  useEffect(() => {
    if (!locationName) return;

    const controller = new AbortController();
    const params = new URLSearchParams({ location: locationName, locale, version: "2" });

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
  }, [locale, locationName, requestKey]);

  return (
    <div className="space-y-4">
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
          <NewsMessage>{t.fireDetail.newsEmpty}</NewsMessage>
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
                    <time className="mt-1 block font-mono text-[11px] uppercase tracking-[0.06em] text-foreground/40">{new Date(article.publishedAt).toLocaleDateString(locale === "pt" ? "pt-PT" : "en-GB")}</time>
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
