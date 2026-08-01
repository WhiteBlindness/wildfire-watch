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
      className="group relative flex min-h-11 items-center gap-2 overflow-hidden rounded-full border border-white/10 bg-neutral-900/80 px-3 py-1.5 text-white shadow-[0_8px_24px_rgba(0,0,0,0.16)] backdrop-blur transition-colors hover:border-white/20 hover:bg-neutral-900/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface text-foreground/70 ring-1 ring-inset ring-border/70 transition-colors group-hover:text-foreground">
        {satellite ? <Satellite aria-hidden="true" className="h-3.5 w-3.5" /> : <Map aria-hidden="true" className="h-3.5 w-3.5" />}
      </span>
      <span className="mission-basemap-label hidden pr-1 text-xs font-semibold">
        {satellite ? t.topBar.satelliteLabel : t.topBar.plainLabel}
      </span>
      <span aria-hidden="true" className="flex items-center relative h-5 w-9 shrink-0 overflow-hidden rounded-full border border-white/10 bg-neutral-900/80 ring-1 ring-inset ring-white/10">
        <span className={`absolute left-[4px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-transform duration-300 ease-in-out bg-red-600 motion-reduce:transition-none ${satellite ? "translate-x-[14px]" : "translate-x-0"}`} />
      </span>
    </button>
  );
}
