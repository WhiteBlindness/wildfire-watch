"use client";

import type { WildfireEvent } from "@/lib/wildfire/types";
import FireDetailsPanel from "./FireDetailsPanel";
import GlobalOverview from "./GlobalOverview";

interface SidePanelProps {
  events: WildfireEvent[];
  selectedEvent: WildfireEvent | null;
  onClose: () => void;
}

export default function SidePanel({ events, selectedEvent, onClose }: SidePanelProps) {
  // Always docked — "Mission Control" reads as a permanent instrument, not a
  // modal that appears/disappears. Only the content and the mobile sheet's
  // height change between the global dashboard and a single fire's detail.
  const detailOpen = selectedEvent !== null;

  return (
    <aside
      className={`fixed inset-x-0 bottom-0 z-20 overflow-y-auto rounded-t-2xl border-t border-border/60 bg-surface/75 shadow-2xl backdrop-blur-xl transition-[max-height] duration-300 ease-out md:inset-y-0 md:right-0 md:left-auto md:top-0 md:h-full md:max-h-none md:w-[400px] md:rounded-none md:rounded-l-2xl md:border-t-0 md:border-l ${
        detailOpen ? "max-h-[75vh]" : "max-h-[60vh]"
      }`}
    >
      {selectedEvent ? (
        <FireDetailsPanel event={selectedEvent} onClose={onClose} />
      ) : (
        <GlobalOverview events={events} />
      )}
    </aside>
  );
}
