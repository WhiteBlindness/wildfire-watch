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
      className="group relative flex min-h-11 items-center gap-2 overflow-hidden rounded-full border border-neutral-200 bg-white/90 px-3 py-1.5 text-neutral-900 shadow-[0_8px_24px_rgba(0,0,0,0.16)] backdrop-blur-md transition-colors hover:border-neutral-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70 dark:border-neutral-800 dark:bg-neutral-900/90 dark:text-neutral-100 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-300 transition-colors group-hover:text-neutral-900 dark:bg-neutral-800 dark:text-neutral-400 dark:ring-neutral-700 dark:group-hover:text-neutral-100">
        {satellite ? <Satellite aria-hidden="true" className="h-3.5 w-3.5" /> : <Map aria-hidden="true" className="h-3.5 w-3.5" />}
      </span>
      <span className="mission-basemap-label hidden pr-1 text-xs font-semibold">
        {satellite ? t.topBar.satelliteLabel : t.topBar.plainLabel}
      </span>
      <span aria-hidden="true" className="relative flex h-5 w-9 shrink-0 items-center overflow-hidden rounded-full border border-neutral-200 bg-neutral-100 ring-1 ring-inset ring-neutral-300 dark:border-neutral-800 dark:bg-neutral-800 dark:ring-neutral-700">
        <span className={`absolute left-[4px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-red-600 transition-transform duration-300 ease-in-out motion-reduce:transition-none dark:bg-red-500 ${satellite ? "translate-x-[14px]" : "translate-x-0"}`} />
      </span>
    </button>
  );
}
