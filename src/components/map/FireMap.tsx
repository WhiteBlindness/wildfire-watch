"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Map, { Layer, Source, type MapLayerMouseEvent, type MapRef } from "react-map-gl/maplibre";
import type { MapLibreEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { WildfireEvent } from "@/lib/wildfire/types";
import { eventsToHeatmapGeoJSON, eventsToMarkerGeoJSON, selectedEventToPolygonGeoJSON } from "@/lib/wildfire/geojson";
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

// Free, no-API-key satellite imagery — only surfaced as a tactical-scanner
// reveal once zoomed into a specific fire (see SATELLITE_OPACITY below); at
// world scale it stays fully transparent so it never competes with the base
// vector style.
const SATELLITE_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_SOURCE_ID = "satellite-src";
const SATELLITE_LAYER_ID = "satellite-layer";

const MARKER_LAYER_ID = "fire-markers";
const MARKER_HIT_AREA_LAYER_ID = "fire-marker-hit-area";
const POLYGON_FILL_LAYER_ID = "fire-polygons-fill";
const HEATMAP_LAYER_ID = "fire-heatmap";
// Every layer whose features carry a `fireId` property — clicking or
// hovering any of them (marker, burned-area fill, or heatmap core) selects
// the fire, not just the small marker dot.
const INTERACTIVE_LAYER_IDS = [MARKER_HIT_AREA_LAYER_ID, MARKER_LAYER_ID, POLYGON_FILL_LAYER_ID, HEATMAP_LAYER_ID];

// Centered on Iberia/the Atlantic rather than the equator — frames Europe,
// North Africa, and the Atlantic on desktop instead of cutting Europe off
// to one side. Also the "Voltar ao mapa global" fly-back target below.
const WORLD_VIEW = { longitude: -9.0, latitude: 39.0, zoom: 3 };
const FIRE_DETAIL_ZOOM = 12;
// Cinematic, not instant — essential:true keeps the animation even under
// prefers-reduced-motion, since the camera move here carries real meaning
// (which fire is now in view), not just decoration.
const FLY_DURATION_MS = 1800;

interface FireMapProps {
  events: WildfireEvent[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  theme: "dark" | "light";
}

export default function FireMap({ events, selectedId, onSelect, theme }: FireMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const heatmapData = useMemo(() => eventsToHeatmapGeoJSON(events), [events]);
  const polygonData = useMemo(() => selectedEventToPolygonGeoJSON(events, selectedId), [events, selectedId]);
  const markerData = useMemo(() => eventsToMarkerGeoJSON(events), [events]);

  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      const fireId = (feature?.properties?.fireId as string | undefined) ?? null;
      onSelect(fireId);
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

  // Cinematic camera: fly to the selected fire (from a map click or a panel
  // click, either way — this only cares about the resulting selectedId), or
  // back out to the world view once nothing is selected.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    // `.loaded()` also throws once the underlying map has been torn down
    // (e.g. a React tree regenerated after an unrelated hydration mismatch
    // leaves a stale ref) — guard defensively so a camera move never crashes
    // the app; worst case, this one flyTo is silently skipped.
    if (!map) return;
    try {
      if (!map.loaded()) return;
    } catch {
      return;
    }

    const selectedEvent = selectedId ? events.find((event) => event.id === selectedId) : null;
    const target = selectedEvent
      ? { center: [selectedEvent.location.lng, selectedEvent.location.lat] as [number, number], zoom: FIRE_DETAIL_ZOOM }
      : { center: [WORLD_VIEW.longitude, WORLD_VIEW.latitude] as [number, number], zoom: WORLD_VIEW.zoom };

    try {
      map.flyTo({ ...target, duration: FLY_DURATION_MS, essential: true });
    } catch {
      // Stale/torn-down map instance — nothing to recover, just skip.
    }
  }, [selectedId, events]);

  return (
    <Map
      ref={mapRef}
      initialViewState={{ longitude: WORLD_VIEW.longitude, latitude: WORLD_VIEW.latitude, zoom: WORLD_VIEW.zoom }}
      mapStyle={STYLE_URL[theme]}
      // Mercator, not globe: globe is the newer/heavier render path and we
      // want a stable baseline on iOS Safari's WebGL implementation first.
      projection="mercator"
      style={{ width: "100%", height: "100%" }}
      interactiveLayerIds={INTERACTIVE_LAYER_IDS}
      onClick={handleClick}
      onMouseMove={handleMove}
      onMouseLeave={() => setHoveredId(null)}
      cursor={hoveredId ? "pointer" : "grab"}
      attributionControl={{ compact: true }}
      onLoad={handleLoad}
    >
      {theme === "dark" && (
        // Mounted first so it lands below every fire layer that follows,
        // but above the base style's own layers (including the background).
        <Source id={SATELLITE_SOURCE_ID} type="raster" tiles={[SATELLITE_TILE_URL]} tileSize={256}>
          <Layer
            id={SATELLITE_LAYER_ID}
            type="raster"
            paint={{
              "raster-brightness-max": 0.35,
              "raster-saturation": -0.7,
              "raster-contrast": 0.2,
              // Invisible at world scale, fades in like a tactical scanner
              // once the cinematic flyTo brings a fire's terrain into view.
              "raster-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 8, 0.6],
            }}
          />
        </Source>
      )}

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
          id={HEATMAP_LAYER_ID}
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
          id={POLYGON_FILL_LAYER_ID}
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
        {/* Invisible 44px hit target keeps dense points easy to select on touch. */}
        <Layer
          id={MARKER_HIT_AREA_LAYER_ID}
          type="circle"
          paint={{ "circle-radius": 22, "circle-opacity": 0, "circle-stroke-opacity": 0 }}
        />
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
