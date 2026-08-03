"use client";

import { Info, Pause, Play, Rewind } from "lucide-react";
import type { CSSProperties } from "react";
import { GLOBAL_TIMELINE_HOURS } from "@/lib/wildfire/temporal";
import { useLocale } from "@/lib/i18n/LocaleProvider";

interface GlobalTimelineControlProps {
  isPlaying: boolean;
  value: number;
  onChange: (value: number) => void;
  onTogglePlayback: () => void;
}

export default function GlobalTimelineControl({ isPlaying, value, onChange, onTogglePlayback }: GlobalTimelineControlProps) {
  const { t } = useLocale();
  const remainingHours = Math.max(0, GLOBAL_TIMELINE_HOURS - value);
  const currentLabel = remainingHours === 0 ? t.timeline.now : `T-${remainingHours}h`;
  const timelineProgress = `${(Math.min(GLOBAL_TIMELINE_HOURS, Math.max(0, value)) / GLOBAL_TIMELINE_HOURS) * 100}%`;

  return (
    <section
      aria-label={t.timeline.controlLabel}
      data-testid="global-timeline"
      className="pointer-events-auto flex w-[min(31rem,calc(100vw-1.5rem))] items-center gap-3 rounded-2xl border border-neutral-200 bg-white/90 px-3 py-2.5 text-neutral-900 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/90 dark:text-neutral-100"
    >
      <button
        type="button"
        onClick={onTogglePlayback}
        aria-label={isPlaying ? t.timeline.pauseLabel : t.timeline.playLabel}
        aria-pressed={isPlaying}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-700 ring-1 ring-inset ring-red-500/30 transition-[background-color,color,transform] duration-200 hover:bg-red-500/25 hover:text-red-800 dark:text-red-300 dark:hover:text-red-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      >
        {isPlaying ? <Pause aria-hidden="true" className="h-4 w-4 fill-current" /> : <Play aria-hidden="true" className="ml-0.5 h-4 w-4 fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-600 dark:text-neutral-400">
            <Rewind aria-hidden="true" className="h-3.5 w-3.5 text-red-500 dark:text-red-400" />
            <span className="truncate">{t.timeline.title}</span>
            <span
              tabIndex={0}
              aria-label={t.timeline.methodologyLabel}
              title={t.timeline.methodologyText}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-neutral-500 outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:text-neutral-400"
            >
              <Info aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
          </span>
          <output className="font-mono text-xs font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{currentLabel}</output>
        </div>
        <input
          aria-label={t.timeline.sliderLabel}
          type="range"
          min={0}
          max={GLOBAL_TIMELINE_HOURS}
          step={1}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          style={{ "--timeline-progress": timelineProgress } as CSSProperties}
          className="timeline-slider block h-6 w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/80"
        />
        <div aria-hidden="true" className="mt-0.5 flex justify-between text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
          <span>T-72h</span>
          <span>T-36h</span>
          <span>{t.timeline.now}</span>
        </div>
      </div>
    </section>
  );
}
