"use client";

import type { WildfireEvent } from "@/lib/wildfire/types";
import { formatThousands } from "@/lib/wildfire/format";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import AdSlot from "@/components/ui/AdSlot";
import FireIntensityChart from "./FireIntensityChart";

interface GlobalOverviewProps {
  events: WildfireEvent[];
}

export default function GlobalOverview({ events }: GlobalOverviewProps) {
  const { t } = useLocale();
  const totalFocos = events.length;
  const totalAreaHectares = events.reduce((sum, event) => sum + event.areaHectares, 0);
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
        <MetricCard
          label={t.overview.metricArea}
          value={`${formatThousands(totalAreaHectares)} ha`}
          tone="neutral"
        />
      </div>

      <FireIntensityChart events={events} />

      <p className="text-xs text-foreground/40">{t.overview.hint}</p>

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
