"use client";

import { Pause, Play, Rewind } from "lucide-react";
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

  return (
    <section
      aria-label={t.timeline.controlLabel}
      data-testid="global-timeline"
      className="pointer-events-auto flex w-[min(31rem,calc(100vw-1.5rem))] items-center gap-3 rounded-2xl border border-white/10 bg-[#12161d]/85 px-3 py-2.5 shadow-[0_18px_50px_rgba(0,0,0,0.34)] backdrop-blur-xl"
    >
      <button
        type="button"
        onClick={onTogglePlayback}
        aria-label={isPlaying ? t.timeline.pauseLabel : t.timeline.playLabel}
        aria-pressed={isPlaying}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-400/30 transition-[background-color,color,transform] duration-200 hover:bg-red-500/25 hover:text-red-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      >
        {isPlaying ? <Pause aria-hidden="true" className="h-4 w-4 fill-current" /> : <Play aria-hidden="true" className="ml-0.5 h-4 w-4 fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/60">
            <Rewind aria-hidden="true" className="h-3.5 w-3.5 text-red-400" />
            {t.timeline.title}
          </span>
          <output className="font-mono text-xs font-semibold tabular-nums text-foreground">{currentLabel}</output>
        </div>
        <input
          aria-label={t.timeline.sliderLabel}
          type="range"
          min={0}
          max={GLOBAL_TIMELINE_HOURS}
          step={1}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="block h-6 w-full cursor-pointer accent-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/80"
        />
        <div aria-hidden="true" className="mt-0.5 flex justify-between text-[11px] font-medium uppercase tracking-[0.08em] text-foreground/35">
          <span>T-72h</span>
          <span>T-36h</span>
          <span>{t.timeline.now}</span>
        </div>
      </div>
    </section>
  );
}
