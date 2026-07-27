"use client";

import { useMemo, useState, useCallback } from "react";
import Map, { Layer, Source, type MapLayerMouseEvent } from "react-map-gl/maplibre";
import type { MapLibreEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { WildfireEvent } from "@/lib/wildfire/types";
import { eventsToHeatmapGeoJSON, eventsToMarkerGeoJSON, eventsToPolygonGeoJSON } from "@/lib/wildfire/geojson";
import { SEVERITY_COLOR } from "@/lib/wildfire/colors";

// Free, no-API-key vector basemaps from CARTO — dark-matter fits the cinematic
// dark theme, positron is the light-mode counterpart. Attribution is baked
// into the style JSON already.
const STYLE_URL = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;

// Cinematic base: pin the dark style's background to slate-900 rather than
// trusting dark-matter's default near-black, so heatmaps/borders pop consistently.
const DARK_BACKGROUND = "#0f172a";

const MARKER_LAYER_ID = "fire-markers";

interface FireMapProps {
  events: WildfireEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  theme: "dark" | "light";
}

export default function FireMap({ events, selectedId, onSelect, theme }: FireMapProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const heatmapData = useMemo(() => eventsToHeatmapGeoJSON(events), [events]);
  const polygonData = useMemo(() => eventsToPolygonGeoJSON(events), [events]);
  const markerData = useMemo(() => eventsToMarkerGeoJSON(events), [events]);

  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      const fireId = feature?.properties?.fireId as string | undefined;
      if (fireId) onSelect(fireId);
    },
    [onSelect],
  );

  const handleMove = useCallback((e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    setHoveredId((feature?.properties?.fireId as string | undefined) ?? null);
  }, []);

  const handleLoad = useCallback(
    (e: MapLibreEvent) => {
      if (theme !== "dark") return;
      const map = e.target;
      // dark-matter's background layer is always id "background" per its style spec.
      if (map.getLayer("background")) {
        map.setPaintProperty("background", "background-color", DARK_BACKGROUND);
      }
    },
    [theme],
  );

  return (
    <Map
      initialViewState={{ longitude: 5, latitude: 25, zoom: 1.6 }}
      mapStyle={STYLE_URL[theme]}
      projection="mercator"
      style={{ width: "100%", height: "100%" }}
      interactiveLayerIds={[MARKER_LAYER_ID]}
      onClick={handleClick}
      onMouseMove={handleMove}
      onMouseLeave={() => setHoveredId(null)}
      cursor={hoveredId ? "pointer" : "grab"}
      attributionControl={{ compact: true }}
      onLoad={handleLoad}
    >
      <Source id="fire-heatmap-src" type="geojson" data={heatmapData}>
        {/* Wide, soft underlay reads as a glow radiating from each hotspot cluster. */}
        <Layer
          id="fire-heatmap-glow"
          type="heatmap"
          paint={{
            "heatmap-weight": ["get", "intensity"],
            "heatmap-intensity": 0.9,
            "heatmap-radius": 55,
            "heatmap-opacity": 0.45,
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0, "rgba(0,0,0,0)",
              0.3, "rgba(249,115,22,0.35)",
              0.6, "rgba(239,68,68,0.5)",
              1, "rgba(185,28,28,0.65)",
            ],
          }}
        />
        <Layer
          id="fire-heatmap"
          type="heatmap"
          paint={{
            "heatmap-weight": ["get", "intensity"],
            "heatmap-intensity": 1.3,
            "heatmap-radius": 20,
            "heatmap-opacity": 0.9,
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0, "rgba(0,0,0,0)",
              0.2, "#fde047",
              0.4, "#f59e0b",
              0.6, "#ef4444",
              0.8, "#b91c1c",
              1, "#fef08a",
            ],
          }}
        />
      </Source>

      <Source id="fire-polygons-src" type="geojson" data={polygonData}>
        <Layer
          id="fire-polygons-fill"
          type="fill"
          paint={{
            "fill-color": [
              "match",
              ["get", "severity"],
              "extreme", "#7f1d1d",
              "high", "#991b1b",
              "moderate", SEVERITY_COLOR.moderate,
              SEVERITY_COLOR.low,
            ],
            "fill-opacity": 0.32,
          }}
        />
        {/* Soft blurred underlay gives the burned-area border a glowing edge. */}
        <Layer
          id="fire-polygons-line-glow"
          type="line"
          paint={{
            "line-color": [
              "match",
              ["get", "severity"],
              "extreme", SEVERITY_COLOR.extreme,
              "high", SEVERITY_COLOR.high,
              "moderate", SEVERITY_COLOR.moderate,
              SEVERITY_COLOR.low,
            ],
            "line-width": 6,
            "line-blur": 4,
            "line-opacity": 0.5,
          }}
        />
        <Layer
          id="fire-polygons-line"
          type="line"
          paint={{
            "line-color": [
              "match",
              ["get", "severity"],
              "extreme", "#ff3b3b",
              "high", "#ff3b3b",
              "moderate", SEVERITY_COLOR.moderate,
              SEVERITY_COLOR.low,
            ],
            "line-width": 2,
          }}
        />
      </Source>

      <Source id="fire-markers-src" type="geojson" data={markerData}>
        <Layer
          id={MARKER_LAYER_ID}
          type="circle"
          paint={{
            "circle-radius": [
              "case",
              ["==", ["get", "fireId"], selectedId ?? ""], 11,
              7,
            ],
            "circle-color": [
              "match",
              ["get", "severity"],
              "extreme", SEVERITY_COLOR.extreme,
              "high", SEVERITY_COLOR.high,
              "moderate", SEVERITY_COLOR.moderate,
              SEVERITY_COLOR.low,
            ],
            "circle-stroke-width": [
              "case",
              ["==", ["get", "fireId"], selectedId ?? ""], 3,
              1.5,
            ],
            "circle-stroke-color": "#ffffff",
          }}
        />
      </Source>
    </Map>
  );
}
