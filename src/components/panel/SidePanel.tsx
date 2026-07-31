"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import type { WildfireEvent } from "@/lib/wildfire/types";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import FireDetailsPanel from "./FireDetailsPanel";
import GlobalOverview from "./GlobalOverview";

interface SidePanelProps {
  events: WildfireEvent[];
  selectedEvent: WildfireEvent | null;
  isMinimized: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  onToggleMinimized: () => void;
}

export default function SidePanel({
  events,
  selectedEvent,
  isMinimized,
  onSelect,
  onClose,
  onToggleMinimized,
}: SidePanelProps) {
  const { t } = useLocale();
  // Always docked — "Mission Control" reads as a permanent instrument, not a
  // modal that appears/disappears. Only the content and the mobile sheet's
  // height change between the global dashboard and a single fire's detail.
  const detailOpen = selectedEvent !== null;

  return (
    <aside
      className={`mission-panel-shell fixed inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden rounded-t-[1.5rem] border-t border-border/60 bg-surface/85 shadow-[0_-16px_48px_rgba(0,0,0,0.28)] backdrop-blur-2xl transition-[max-height,transform,background-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none md:inset-y-0 md:right-0 md:left-auto md:top-0 md:h-full md:max-h-none md:w-[400px] md:translate-y-0 md:rounded-none md:rounded-l-2xl md:border-t-0 md:border-l md:shadow-[-18px_0_56px_rgba(0,0,0,0.24)] ${
        detailOpen ? "max-h-[75vh]" : "max-h-[60vh]"
      } ${isMinimized ? "translate-y-[calc(100%-4rem)]" : "translate-y-0"}`}
    >
      <div className="relative flex h-[4.25rem] shrink-0 items-center justify-center border-b border-border/40 px-4 pt-1 md:hidden">
        <span aria-hidden="true" className="absolute top-2 h-1 w-10 rounded-full bg-foreground/18" />
        <button
          type="button"
          aria-controls="mission-control-panel-content"
          aria-expanded={!isMinimized}
          onClick={onToggleMinimized}
          className="flex min-h-11 min-w-44 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-foreground/75 transition-[color,background-color,transform] duration-200 hover:bg-surface-muted/80 hover:text-foreground active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70"
        >
          {isMinimized ? t.panel.expand : t.panel.collapse}
          {isMinimized ? (
            <ChevronUp aria-hidden="true" className="h-4 w-4" />
          ) : (
            <ChevronDown aria-hidden="true" className="h-4 w-4" />
          )}
        </button>
      </div>

      <div id="mission-control-panel-content" className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth">
        <div key={selectedEvent?.id ?? "overview"} className="min-h-full motion-safe:animate-[panel-content-enter_280ms_ease-out_both]">
          {selectedEvent ? (
            <FireDetailsPanel event={selectedEvent} onClose={onClose} />
          ) : (
            <GlobalOverview events={events} onSelect={onSelect} />
          )}
        </div>
      </div>
    </aside>
  );
}
