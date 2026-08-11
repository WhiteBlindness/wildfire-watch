"use client";

import { Info, Maximize2, Minimize2, Pause, Play, Rewind } from "lucide-react";
import { useState, type CSSProperties } from "react";
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
  const [isMinimized, setIsMinimized] = useState(false);
  const remainingHours = Math.max(0, GLOBAL_TIMELINE_HOURS - value);
  const currentLabel = remainingHours === 0 ? t.timeline.now : `T-${remainingHours}h`;
  const timelineProgress = `${(Math.min(GLOBAL_TIMELINE_HOURS, Math.max(0, value)) / GLOBAL_TIMELINE_HOURS) * 100}%`;

  return (
    <section
      aria-label={t.timeline.controlLabel}
      data-testid="global-timeline"
      className={`pointer-events-auto relative z-30 overflow-hidden border border-neutral-200 bg-white/90 text-neutral-900 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur-md transition-[width,height,border-radius,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none dark:border-neutral-800 dark:bg-neutral-900/90 dark:text-neutral-100 ${
        isMinimized
          ? "ml-auto h-12 w-20 rounded-full"
          : "mx-auto h-[5.5rem] w-[min(31rem,calc(100vw-1.5rem))] rounded-2xl"
      }`}
    >
      <div
        id="global-timeline-controls"
        aria-hidden={isMinimized}
        className={`flex h-full items-center gap-4 px-3 py-2.5 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
          isMinimized ? "pointer-events-none -translate-x-2 opacity-0" : "translate-x-0 opacity-100"
        }`}
      >
        <button
          type="button"
          onClick={onTogglePlayback}
          aria-label={isPlaying ? t.timeline.pauseLabel : t.timeline.playLabel}
          aria-pressed={isPlaying}
          tabIndex={isMinimized ? -1 : 0}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-700 ring-1 ring-inset ring-red-500/30 transition-[background-color,color,transform] duration-200 hover:bg-red-500/25 hover:text-red-800 dark:text-red-300 dark:hover:text-red-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          {isPlaying ? <Pause aria-hidden="true" className="h-4 w-4 fill-current" /> : <Play aria-hidden="true" className="ml-0.5 h-4 w-4 fill-current" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-3">
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-600 dark:text-neutral-400">
              <Rewind aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-red-500 dark:text-red-400" />
              <span className="truncate">{t.timeline.title}</span>
              <span
                tabIndex={isMinimized ? -1 : 0}
                aria-label={t.timeline.methodologyLabel}
                title={t.timeline.methodologyText}
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-neutral-500 outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:text-neutral-400"
              >
                <Info aria-hidden="true" className="h-3.5 w-3.5" />
              </span>
            </span>
            <output className="shrink-0 font-mono text-xs font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{currentLabel}</output>
            <button
              type="button"
              aria-label={t.timeline.minimizeLabel}
              aria-controls="global-timeline-controls"
              aria-expanded="true"
              tabIndex={isMinimized ? -1 : 0}
              onClick={() => setIsMinimized(true)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition-[background-color,color,transform] duration-200 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            >
              <Minimize2 aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
          <input
            aria-label={t.timeline.sliderLabel}
            type="range"
            min={0}
            max={GLOBAL_TIMELINE_HOURS}
            step={1}
            value={value}
            tabIndex={isMinimized ? -1 : 0}
            onChange={(event) => onChange(Number(event.target.value))}
            style={{ "--timeline-progress": timelineProgress } as CSSProperties}
            className="timeline-slider block h-6 w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/80"
          />
          <div aria-hidden="true" className="mt-0.5 flex justify-between font-mono text-[11px] font-medium uppercase tabular-nums tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
            <span>T-72h</span>
            <span>T-36h</span>
            <span>{t.timeline.now}</span>
          </div>
        </div>
      </div>
      <button
        type="button"
        aria-label={t.timeline.expandLabel}
        aria-controls="global-timeline-controls"
        aria-expanded="false"
        tabIndex={isMinimized ? 0 : -1}
        onClick={() => setIsMinimized(false)}
        className={`absolute inset-0 flex items-center justify-center gap-1.5 text-xs font-semibold text-neutral-700 transition-[opacity,transform,background-color,color] duration-200 ease-out hover:bg-neutral-100/70 hover:text-neutral-950 dark:text-neutral-200 dark:hover:bg-neutral-800/70 dark:hover:text-white motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${
          isMinimized ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-2 opacity-0"
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${isPlaying ? "animate-pulse bg-red-500" : "bg-neutral-400 dark:bg-neutral-500"}`} aria-hidden="true" />
        <span className="font-mono tabular-nums">{currentLabel}</span>
        <Maximize2 aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </section>
  );
}
