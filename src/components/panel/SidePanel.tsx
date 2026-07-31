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
      className={`fixed inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden rounded-t-2xl border-t border-border/60 bg-surface/90 shadow-2xl backdrop-blur-xl transition-[max-height,transform] duration-300 ease-out md:inset-y-0 md:right-0 md:left-auto md:top-0 md:h-full md:max-h-none md:w-[400px] md:translate-y-0 md:rounded-none md:rounded-l-2xl md:border-t-0 md:border-l ${
        detailOpen ? "max-h-[75vh]" : "max-h-[60vh]"
      } ${isMinimized ? "translate-y-[calc(100%-4rem)]" : "translate-y-0"}`}
    >
      <div className="flex h-16 shrink-0 items-center justify-center border-b border-border/40 px-4 md:hidden">
        <button
          type="button"
          aria-controls="mission-control-panel-content"
          aria-expanded={!isMinimized}
          onClick={onToggleMinimized}
          className="flex min-h-11 min-w-44 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-foreground/80 transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
        >
          {isMinimized ? t.panel.expand : t.panel.collapse}
          {isMinimized ? (
            <ChevronUp aria-hidden="true" className="h-4 w-4" />
          ) : (
            <ChevronDown aria-hidden="true" className="h-4 w-4" />
          )}
        </button>
      </div>

      <div id="mission-control-panel-content" className="min-h-0 flex-1 overflow-y-auto">
        {selectedEvent ? (
          <FireDetailsPanel event={selectedEvent} onClose={onClose} />
        ) : (
          <GlobalOverview events={events} onSelect={onSelect} />
        )}
      </div>
    </aside>
  );
}
