"use client";

import { Map, Satellite } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleProvider";

export type BasemapMode = "satellite" | "plain";

export default function BasemapToggle({
  mode,
  onChange,
}: {
  mode: BasemapMode;
  onChange: (mode: BasemapMode) => void;
}) {
  const { t } = useLocale();
  const satellite = mode === "satellite";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={satellite}
      aria-label={t.topBar.basemapToggleLabel}
      onClick={() => onChange(satellite ? "plain" : "satellite")}
      className="group flex h-11 items-center gap-1.5 rounded-full border border-border bg-surface-muted px-2 text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)] transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70 sm:gap-2 sm:px-2.5"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface text-foreground/70 ring-1 ring-inset ring-border/70 transition-colors group-hover:text-foreground">
        {satellite ? <Satellite aria-hidden="true" className="h-3.5 w-3.5" /> : <Map aria-hidden="true" className="h-3.5 w-3.5" />}
      </span>
      <span className="mission-basemap-label hidden pr-1 text-xs font-semibold">
        {satellite ? t.topBar.satelliteLabel : t.topBar.plainLabel}
      </span>
      <span aria-hidden="true" className="relative h-5 w-9 rounded-full bg-background/50 ring-1 ring-inset ring-border/70">
        <span className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-red-500 transition-transform duration-300 ${satellite ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
      </span>
    </button>
  );
}
