"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import TopBar from "@/components/layout/TopBar";
import Legend from "@/components/map/Legend";
import MapLoadingState from "@/components/map/MapLoadingState";
import SidePanel from "@/components/panel/SidePanel";
import { firmsAdapter } from "@/lib/wildfire/firms-adapter";
import type {
  FeedLoadStatus,
  FireSelection,
  WildfireFeedSnapshot,
} from "@/lib/wildfire/types";
import type { BasemapMode } from "@/components/ui/BasemapToggle";
import GlobalTimelineControl from "@/components/map/GlobalTimelineControl";
import { GLOBAL_TIMELINE_HOURS, GLOBAL_TIMELINE_NOW } from "@/lib/wildfire/temporal";

// MapLibre touches `window` on import, so the map must never render during SSR.
// The branded fallback also covers the JavaScript chunk-loading window.
const FireMap = dynamic(() => import("@/components/map/FireMap"), {
  ssr: false,
  loading: () => <MapLoadingState announce={false} />,
});

interface HomeClientProps {
  feedSnapshot?: WildfireFeedSnapshot;
}

export default function HomeClient({ feedSnapshot: initialSnapshot }: HomeClientProps) {
  const { resolvedTheme } = useTheme();
  const [feedSnapshot, setFeedSnapshot] = useState<WildfireFeedSnapshot | null>(initialSnapshot ?? null);
  const [feedState, setFeedState] = useState<FeedLoadStatus>(initialSnapshot ? "ready" : "loading");
  const events = useMemo(() => feedSnapshot?.events ?? [], [feedSnapshot]);
  const [feedRetryNonce, setFeedRetryNonce] = useState(0);
  const [isMapReady, setIsMapReady] = useState(false);
  const [selectedFire, setSelectedFire] = useState<FireSelection | null>(null);
  const [isPanelMinimized, setIsPanelMinimized] = useState(true);
  const [selectedCountry, setSelectedCountry] = useState("global");
  const [basemapMode, setBasemapMode] = useState<BasemapMode>("satellite");
  // Start at the right edge of the slider so every currently active global
  // hotspot is visible before the visitor opts into historical playback.
  const [timelineHour, setTimelineHour] = useState(GLOBAL_TIMELINE_NOW);
  const [isTimelinePlaying, setIsTimelinePlaying] = useState(false);

  useEffect(() => {
    if (!isTimelinePlaying) return;
    const timer = window.setInterval(() => {
      setTimelineHour((current) => current >= GLOBAL_TIMELINE_HOURS ? 0 : current + 1);
    }, 650);
    return () => window.clearInterval(timer);
  }, [isTimelinePlaying]);

  // The page request remains tiny: hotspot data arrives from the Worker KV
  // endpoint after hydration. NASA is only contacted by the hourly ingestor.
  useEffect(() => {
    let cancelled = false;

    firmsAdapter.getSnapshot().then((snapshot) => {
      if (cancelled) return;
      setFeedSnapshot(snapshot);
      setFeedState("ready");
    }).catch((error: unknown) => {
      if (cancelled) return;
      console.error("Unable to load cached FIRMS hotspots", error);
      // Preserve any last-known snapshot so the overview can call it out as
      // stale rather than silently replacing it with an empty state.
      setFeedState("error");
    });
    return () => {
      cancelled = true;
    };
  }, [feedRetryNonce]);

  const countries = useMemo(
    () => [...new Set(events
      .map((event) => event.country)
      .filter((country) => country && !country.includes("unmatched")))]
      .sort((a, b) => a.localeCompare(b, "pt")),
    [events],
  );
  const filteredEvents = useMemo(
    () => selectedCountry === "global"
      ? events
      : events.filter((event) => event.country === selectedCountry),
    [events, selectedCountry],
  );
  const mapTheme = resolvedTheme === "light" ? "light" : "dark";
  const isInitialLoading = !isMapReady || (feedState === "loading" && !feedSnapshot);

  const handleMapLoad = useCallback(() => {
    setIsMapReady(true);
  }, []);

  function handleMapSelect(selection: FireSelection | null): void {
    setSelectedFire(selection);
    if (selection) setIsPanelMinimized(false);
  }

  function handleCountryChange(country: string): void {
    setSelectedCountry(country);
    setSelectedFire(null);
    setIsPanelMinimized(false);
  }

  function handleFeedRetry(): void {
    setFeedState("loading");
    setFeedRetryNonce((value) => value + 1);
  }

  return (
    <main
      className="wildfire-watch relative h-dvh w-full overflow-hidden"
      data-map-panel-open={selectedFire || !isPanelMinimized ? "true" : "false"}
    >
      {/* Keep MapLibre mounted under the branded lifecycle layer so it can
          measure the viewport and finish style work while data is pending. */}
      <div className={`wildfire-watch-map absolute inset-0 z-0 transition-opacity duration-[400ms] motion-reduce:duration-0 ${isInitialLoading ? "opacity-0" : "opacity-100"}`}>
        <FireMap
          events={filteredEvents}
          perimeterEvents={events}
          selectedFire={selectedFire}
          onSelect={handleMapSelect}
          onMapLoad={handleMapLoad}
          theme={mapTheme}
          basemapMode={basemapMode}
          countryScope={selectedCountry}
          timelineHour={timelineHour}
        />
      </div>

      {isInitialLoading && <MapLoadingState />}
      {!isInitialLoading && feedState === "error" && (
        <MapLoadingState mode="error" onRetry={handleFeedRetry} />
      )}

      <TopBar basemapMode={basemapMode} onBasemapChange={setBasemapMode} />

      <div className={`pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3 md:right-[416px] md:left-0 md:bottom-4 ${selectedFire ? "bottom-[calc(75vh+0.75rem)]" : "bottom-[5rem]"}`}>
        <GlobalTimelineControl
          value={timelineHour}
          isPlaying={isTimelinePlaying}
          onChange={(nextValue) => {
            setTimelineHour(nextValue);
            setIsTimelinePlaying(false);
          }}
          onTogglePlayback={() => setIsTimelinePlaying((current) => !current)}
        />
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-10 hidden items-end justify-start p-4 md:right-[416px] md:flex">
        <Legend />
      </div>

      <SidePanel
        events={filteredEvents}
        selectedFire={selectedFire}
        isMinimized={isPanelMinimized}
        onClose={() => handleMapSelect(null)}
        onToggleMinimized={() => setIsPanelMinimized((current) => !current)}
        countries={countries}
        selectedCountry={selectedCountry}
        onCountryChange={handleCountryChange}
        feedSnapshot={feedSnapshot}
        feedState={feedState}
      />
    </main>
  );
}
