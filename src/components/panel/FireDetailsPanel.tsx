"use client";

import type { WildfireEvent } from "@/lib/wildfire/types";
import { formatThousands } from "@/lib/wildfire/format";
import { interpolate } from "@/lib/i18n/dictionaries";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import FireEvolutionChart from "./FireEvolutionChart";
import AdSlot from "@/components/ui/AdSlot";

interface FireDetailsPanelProps {
  event: WildfireEvent;
  onClose: () => void;
}

const DATE_LOCALE: Record<"en" | "pt", string> = { en: "en-GB", pt: "pt-PT" };

const STATUS_BADGE_CLASS: Record<WildfireEvent["status"], string> = {
  active: "bg-red-500/15 text-red-400 ring-1 ring-red-500/40",
  contained: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/40",
  extinguished: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40",
};

export default function FireDetailsPanel({ event, onClose }: FireDetailsPanelProps) {
  const { locale, t } = useLocale();

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
    <div className="flex h-full flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{event.name}</h2>
          <p className="text-sm text-foreground/60">
            {event.region}, {event.country}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.fireDetail.closeLabel}
          className="rounded-full border border-border p-1.5 text-foreground/60 hover:text-foreground"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs font-medium">
        <span className={`rounded-full px-2.5 py-1 ${STATUS_BADGE_CLASS[event.status]}`}>
          {t.status[event.status]}
        </span>
        <span className="rounded-full bg-surface-muted px-2.5 py-1 text-foreground/70 ring-1 ring-border">
          {t.fireDetail.severityLabel}: {t.legend[event.severity]}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Stat label={t.fireDetail.areaLabel} value={`${formatThousands(event.areaHectares)} ha`} />
        <Stat label={t.fireDetail.startLabel} value={formatDateTime(event.startedAt)} />
        <Stat
          label={event.status === "active" ? t.fireDetail.containmentEtaLabel : t.fireDetail.containedAtLabel}
          value={
            event.status === "active"
              ? event.estimatedContainmentAt
                ? formatDateTime(event.estimatedContainmentAt)
                : "—"
              : event.containedAt
                ? formatDateTime(event.containedAt)
                : "—"
          }
        />
        {event.wind && (
          <Stat
            label={t.fireDetail.windLabel}
            value={`${event.wind.speedKmh} km/h, ${event.wind.directionDeg}°`}
          />
        )}
      </dl>

      {event.forces && (
        <div className="rounded-lg border border-border bg-surface-muted/50 p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/50">
            {t.fireDetail.forcesTitle}
          </h3>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Stat label={t.fireDetail.firefightersLabel} value={formatThousands(event.forces.firefighters)} />
            <Stat label={t.fireDetail.vehiclesLabel} value={formatThousands(event.forces.vehicles)} />
            <Stat label={t.fireDetail.planesLabel} value={String(event.forces.aircraft.planes)} />
            <Stat label={t.fireDetail.helicoptersLabel} value={String(event.forces.aircraft.helicopters)} />
          </dl>
        </div>
      )}

      {event.internationalAid?.requested && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium text-amber-400">
            {event.internationalAid.active ? t.fireDetail.aidActive : t.fireDetail.aidRequested}
          </p>
          {event.internationalAid.countries.length > 0 && (
            <p className="mt-1 text-foreground/70">{event.internationalAid.countries.join(", ")}</p>
          )}
        </div>
      )}

      {event.evolution && event.evolution.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/50">
            {t.fireDetail.evolutionTitle}
          </h3>
          <FireEvolutionChart data={event.evolution} />
        </div>
      )}

      {event.source !== "mock" && (
        <p className="text-xs text-foreground/40">
          {interpolate(t.fireDetail.provenanceNote, { source: event.source.toUpperCase() })}
        </p>
      )}

      <div className="mt-auto pt-2">
        <AdSlot variant="panel-rectangle" />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-foreground/50">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}
