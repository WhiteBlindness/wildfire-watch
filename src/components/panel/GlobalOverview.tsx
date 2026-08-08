"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { FeedLoadStatus, FeedFreshness, WildfireEvent, WildfireFeedSnapshot } from "@/lib/wildfire/types";
import { formatThousands } from "@/lib/wildfire/format";
import { calculateOverviewMetrics } from "@/lib/wildfire/overview-metrics";
import { useLocale } from "@/lib/i18n/LocaleProvider";

const FEED_STALE_AFTER_MS = 90 * 60 * 1000;

interface GlobalOverviewProps {
  events: WildfireEvent[];
  countries: string[];
  selectedCountry: string;
  onCountryChange: (country: string) => void;
  feedSnapshot: WildfireFeedSnapshot | null;
  feedState: FeedLoadStatus;
}

export default function GlobalOverview({
  events,
  countries,
  selectedCountry,
  onCountryChange,
  feedSnapshot,
  feedState,
}: GlobalOverviewProps) {
  const { locale, t } = useLocale();
  const [now, setNow] = useState<number | null>(null);
  const totalFoci = events.length;
  const metrics = useMemo(() => calculateOverviewMetrics(events), [events]);
  const freshness = useMemo(
    () => getFeedFreshness(feedSnapshot, feedState, now),
    [feedSnapshot, feedState, now],
  );
  const parsedGeneratedAt = feedSnapshot?.generatedAt ? Date.parse(feedSnapshot.generatedAt) : Number.NaN;
  const hasValidGeneratedAt = Number.isFinite(parsedGeneratedAt);
  const relativeFreshness = hasValidGeneratedAt && now !== null
    ? formatRelativeFreshness(feedSnapshot!.generatedAt!, now, locale, t.overview.freshnessUpdated)
    : null;
  const exactTimestamp = hasValidGeneratedAt
    ? new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(parsedGeneratedAt))
    : null;
  const sourceId = feedSnapshot?.sourceId ?? "NASA FIRMS VIIRS_SNPP_NRT";
  const sourceLabel = feedSnapshot?.sourceLabel ?? "NASA FIRMS Satellite Telemetry";
  const lastUpdateText = exactTimestamp
    ?? (feedState === "loading" && !feedSnapshot ? t.overview.freshnessLoading : t.overview.freshnessUnavailable);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t.overview.title}</h2>
        <p className="text-sm text-foreground/60">{t.overview.subtitle}</p>
      </div>

      <section
        aria-label={`${t.overview.sourceLabel}: ${sourceLabel}`}
        className={`rounded-xl border p-3.5 backdrop-blur-xl ${freshness === "stale" ? "border-amber-400/35 bg-amber-500/8" : freshness === "unavailable" ? "border-red-400/35 bg-red-500/8" : "border-border/60 bg-surface-muted/35"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/50">{t.overview.sourceLabel}</p>
            <p className="mt-1 break-words text-sm font-semibold text-foreground">{sourceLabel}</p>
          </div>
          <FreshnessBadge freshness={freshness} labels={t.overview} />
        </div>
        <dl className="mt-3 border-t border-border/45 pt-3 text-xs">
          <div className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.07em] text-foreground/45">{t.overview.sourceIdentifier}</dt>
            <dd className="mt-1 break-words font-mono text-[11px] text-foreground/75">{sourceId}</dd>
          </div>
        </dl>
        {freshness === "stale" && (
          <p className="mt-3 text-xs leading-5 text-amber-700/90 dark:text-amber-200/85">{t.overview.staleLastKnown}</p>
        )}
      </section>

      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-foreground/50">
          {t.overview.countryLabel}
        </span>
        <select
          value={selectedCountry}
          onChange={(event) => onCountryChange(event.currentTarget.value)}
          className="h-11 w-full rounded-xl border border-border/70 bg-surface/90 px-3 text-base font-medium text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)] outline-none transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-red-500/70 sm:text-sm"
        >
          <option value="global">{t.overview.globalOption}</option>
          {countries.map((country) => <option key={country} value={country}>{country}</option>)}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label={t.overview.metricFoci}
          value={feedSnapshot ? formatThousands(totalFoci) : "—"}
          tone="neutral"
        />
        <MetricCard
          label={t.overview.metricMaxFrp}
          value={metrics ? `${formatMegawatts(metrics.maxFrpMw, locale)} MW` : "—"}
          tone="critical"
        />
        <MetricCard
          label={t.overview.metricAverageFrp}
          value={metrics ? `${formatMegawatts(metrics.averageFrpMw, locale)} MW` : "—"}
          tone="neutral"
        />
        <MetricCard
          label={t.overview.metricProjectedBurnArea}
          badge={t.overview.projectionLabel}
          value={metrics ? `${formatHectares(metrics.projectedBurnAreaHectares, locale)} ha` : "—"}
          note={t.overview.projectionMethodology}
          tone="neutral"
        />
        <MetricCard
          className="col-span-2 sm:col-span-1"
          label={t.overview.metricLastUpdate}
          value={lastUpdateText}
          valueNode={feedSnapshot?.generatedAt && exactTimestamp ? (
            <time dateTime={feedSnapshot.generatedAt} title={relativeFreshness ?? undefined} className="block">
              <span className="block text-lg leading-tight">{exactTimestamp}</span>
              {relativeFreshness && (
                <span className="mt-1 block text-[11px] font-medium text-foreground/50">{relativeFreshness}</span>
              )}
            </time>
          ) : undefined}
          tone={freshness === "stale" ? "warning" : freshness === "unavailable" ? "critical" : "neutral"}
        />
      </div>

      <p className="text-xs text-foreground/50">{t.overview.hint}</p>
    </div>
  );
}

type OverviewLabels = {
  freshnessLoading: string;
  freshnessCurrent: string;
  freshnessStale: string;
  freshnessUnavailable: string;
  freshnessUpdated: string;
  staleLastKnown: string;
};

function getFeedFreshness(
  snapshot: WildfireFeedSnapshot | null,
  state: FeedLoadStatus,
  now: number | null,
): FeedFreshness | "loading" {
  if (state === "loading" && !snapshot) return "loading";
  if (state === "error") return snapshot ? "stale" : "unavailable";
  if (!snapshot?.generatedAt) return "unavailable";
  const generatedAt = Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(generatedAt)) return "unavailable";
  const age = Math.max(0, (now ?? generatedAt) - generatedAt);
  return age > FEED_STALE_AFTER_MS ? "stale" : "current";
}

function formatRelativeFreshness(generatedAt: string, now: number, locale: "en" | "pt", prefix: string): string {
  const elapsedMinutes = Math.max(0, Math.floor((now - Date.parse(generatedAt)) / 60_000));
  const formatter = new Intl.RelativeTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { numeric: "always" });
  return `${prefix} ${formatter.format(-elapsedMinutes, "minute")}`;
}

function FreshnessBadge({ freshness, labels }: { freshness: FeedFreshness | "loading"; labels: OverviewLabels }) {
  const label = freshness === "loading"
    ? labels.freshnessLoading
    : freshness === "current"
      ? labels.freshnessCurrent
      : freshness === "stale"
        ? labels.freshnessStale
        : labels.freshnessUnavailable;
  const tone = freshness === "stale"
    ? "text-amber-700 dark:text-amber-200"
    : freshness === "unavailable"
      ? "text-red-700 dark:text-red-200"
      : "text-foreground/70";

  return (
    <span aria-live="polite" className={`inline-flex max-w-[10rem] shrink-0 items-center gap-1.5 text-right text-[11px] font-semibold uppercase tracking-[0.07em] ${tone}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${freshness === "stale" ? "bg-amber-400" : freshness === "unavailable" ? "bg-red-400" : "bg-foreground/50"}`} />
      {label}
    </span>
  );
}

function MetricCard({
  badge,
  className,
  label,
  note,
  value,
  valueNode,
  tone,
}: {
  badge?: string;
  className?: string;
  label: string;
  note?: string;
  value: string;
  valueNode?: ReactNode;
  tone: "neutral" | "critical" | "warning";
}) {
  return (
    <div className={`rounded-lg border border-border/60 bg-surface/75 p-4 shadow-lg backdrop-blur-xl ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50">{label}</p>
        {badge && <span className="shrink-0 rounded-full bg-amber-500/12 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-700 dark:text-amber-300">{badge}</span>}
      </div>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === "critical" ? "text-rose-500" : tone === "warning" ? "text-amber-500" : "text-foreground"
        }`}
      >
        {valueNode ?? value}
      </p>
      {note && <p className="mt-2 text-[11px] leading-4 text-foreground/50">{note}</p>}
    </div>
  );
}

function formatMegawatts(value: number, locale: "en" | "pt"): string {
  return new Intl.NumberFormat(locale === "pt" ? "pt-PT" : "en-GB", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatHectares(value: number, locale: "en" | "pt"): string {
  return new Intl.NumberFormat(locale === "pt" ? "pt-PT" : "en-GB", {
    maximumFractionDigits: 1,
  }).format(value);
}
