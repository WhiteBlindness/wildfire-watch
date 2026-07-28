"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import TopBar from "@/components/layout/TopBar";
import Legend from "@/components/map/Legend";
import SidePanel from "@/components/panel/SidePanel";
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
    <main className="relative h-dvh w-full">
      {/* h-dvh (dynamic viewport height), not h-full/h-screen: iOS Safari's
          collapsing/expanding address bar resizes the *visual* viewport, and
          a height chain built on percentages anchored to the *layout*
          viewport (html/body height:100%) can end up 0/mis-sized there. dvh
          is viewport-relative on its own, so this wrapper no longer depends
          on that ancestor chain at all. */}
      <FireMap events={events} selectedId={selectedId} onSelect={setSelectedId} theme={mapTheme} />

      <TopBar />

      {/* The side panel is permanently docked now (Global Overview when
          nothing is selected) — desktop only, and kept clear of its 400px
          reserved width so it never renders underneath it. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-10 hidden items-end justify-between gap-3 p-4 md:right-[416px] md:flex">
        <Legend />
        <div className="pointer-events-auto shrink-0">
          <AdSlot variant="sidebar-banner" />
        </div>
      </div>

      <SidePanel
        events={events}
        selectedEvent={selectedEvent}
        onSelect={setSelectedId}
        onClose={() => setSelectedId(null)}
      />
    </main>
  );
}
