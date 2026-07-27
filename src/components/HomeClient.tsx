"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import TopBar from "@/components/layout/TopBar";
import Legend from "@/components/map/Legend";
import FireDetailsPanel from "@/components/panel/FireDetailsPanel";
import AdSlot from "@/components/ui/AdSlot";
import type { WildfireEvent } from "@/lib/wildfire/types";

// MapLibre touches `window` on import, so the map must never render during SSR.
const FireMap = dynamic(() => import("@/components/map/FireMap"), { ssr: false });

interface HomeClientProps {
  events: WildfireEvent[];
}

export default function HomeClient({ events }: HomeClientProps) {
  const { resolvedTheme } = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedEvent = events.find((event) => event.id === selectedId) ?? null;
  const mapTheme = resolvedTheme === "light" ? "light" : "dark";

  return (
    <main className="relative h-full w-full">
      <FireMap events={events} selectedId={selectedId} onSelect={setSelectedId} theme={mapTheme} />

      <TopBar />

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-3 md:p-4">
        <Legend />
        <div className="pointer-events-auto hidden md:block">
          <AdSlot variant="sidebar-banner" />
        </div>
      </div>

      {!selectedEvent && (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-10 flex justify-center md:hidden">
          <div className="pointer-events-auto">
            <AdSlot variant="mobile-leaderboard" />
          </div>
        </div>
      )}

      <FireDetailsPanel event={selectedEvent} onClose={() => setSelectedId(null)} />
    </main>
  );
}
