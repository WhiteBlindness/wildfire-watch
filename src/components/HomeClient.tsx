"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import TopBar from "@/components/layout/TopBar";
import Legend from "@/components/map/Legend";
import SidePanel from "@/components/panel/SidePanel";
import AdSlot from "@/components/ui/AdSlot";
import { generateMockEvents } from "@/lib/wildfire/mock-generator";
import type { WildfireEvent } from "@/lib/wildfire/types";

// MapLibre touches `window` on import, so the map must never render during SSR.
const FireMap = dynamic(() => import("@/components/map/FireMap"), { ssr: false });

interface HomeClientProps {
  events?: WildfireEvent[];
}

export default function HomeClient({ events: initialEvents = [] }: HomeClientProps) {
  const { resolvedTheme } = useTheme();
  const [events, setEvents] = useState<WildfireEvent[]>(initialEvents);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPanelMinimized, setIsPanelMinimized] = useState(true);

  // Keep the Worker response lean. The fallback dataset is deterministic and
  // contains no server secrets, so generating it after hydration avoids
  // serializing the full map payload into HTML/RSC on every request.
  useEffect(() => {
    if (initialEvents.length > 0) return;

    const controller = new AbortController();
    const frame = requestAnimationFrame(() => setEvents(generateMockEvents()));

    async function loadEvents() {
      try {
        const response = await fetch("/api/fires", {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`Fire feed failed: ${response.status}`);

        const nextEvents = (await response.json()) as WildfireEvent[];
        if (!controller.signal.aborted && nextEvents.length > 0) setEvents(nextEvents);
      } catch (error) {
        if (!controller.signal.aborted) console.warn("[wildfire] Using local fallback data.", error);
      }
    }

    void loadEvents();
    return () => {
      controller.abort();
      cancelAnimationFrame(frame);
    };
  }, [initialEvents]);

  const selectedEvent = events.find((event) => event.id === selectedId) ?? null;
  const mapTheme = resolvedTheme === "light" ? "light" : "dark";

  function handleSelect(id: string | null): void {
    setSelectedId(id);
    if (id) setIsPanelMinimized(false);
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      {/* h-dvh (dynamic viewport height), not h-full/h-screen: iOS Safari's
          collapsing/expanding address bar resizes the *visual* viewport, and
          a height chain built on percentages anchored to the *layout*
          viewport (html/body height:100%) can end up 0/mis-sized there. dvh
          is viewport-relative on its own, so this wrapper no longer depends
          on that ancestor chain at all.

          The map sits in its own absolutely-positioned layer rather than
          growing from flex/percentage rules, so its size never depends on
          sibling layout, and it owns the bottom of the stacking order. */}
      <div className="absolute inset-0 z-0">
        <FireMap events={events} selectedId={selectedId} onSelect={handleSelect} theme={mapTheme} />
      </div>

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
        isMinimized={isPanelMinimized}
        onSelect={(id) => handleSelect(id)}
        onClose={() => handleSelect(null)}
        onToggleMinimized={() => setIsPanelMinimized((current) => !current)}
      />
    </main>
  );
}
