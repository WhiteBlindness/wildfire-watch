"use client";

import type { WildfireEvent } from "@/lib/wildfire/types";
import { formatThousands } from "@/lib/wildfire/format";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import AdSlot from "@/components/ui/AdSlot";
import FireIntensityChart from "./FireIntensityChart";

interface GlobalOverviewProps {
  events: WildfireEvent[];
  onSelect: (id: string) => void;
  countries: string[];
  selectedCountry: string;
  onCountryChange: (country: string) => void;
}

export default function GlobalOverview({
  events,
  onSelect,
  countries,
  selectedCountry,
  onCountryChange,
}: GlobalOverviewProps) {
  const { t } = useLocale();
  const totalFocos = events.length;
  const maxFrpMw = events.reduce<number | null>((max, event) => {
    if (event.maxFrpMw == null) return max;
    return max == null ? event.maxFrpMw : Math.max(max, event.maxFrpMw);
  }, null);

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t.overview.title}</h2>
        <p className="text-sm text-foreground/60">{t.overview.subtitle}</p>
      </div>

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

      <div className="grid grid-cols-1 gap-3">
        <MetricCard
          label={t.overview.metricFoci}
          value={formatThousands(totalFocos)}
          tone="neutral"
        />
        <MetricCard
          label={t.overview.metricMaxFrp}
          value={maxFrpMw != null ? `${formatThousands(maxFrpMw)} MW` : "—"}
          tone="critical"
        />
      </div>

      <FireIntensityChart events={events} onSelect={onSelect} />

      <p className="text-xs text-foreground/50">{t.overview.hint}</p>

      <div className="mt-auto pt-2">
        <AdSlot variant="panel-rectangle" />
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "critical";
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface/75 p-4 shadow-lg backdrop-blur-xl">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === "critical" ? "text-rose-500" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
