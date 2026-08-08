"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Map, { AttributionControl, Layer, Source, type MapLayerMouseEvent, type MapRef } from "react-map-gl/maplibre";
import type { GeoJSONSource, Map as MapLibreMap, MapLibreEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FireSelection, WildfireEvent } from "@/lib/wildfire/types";
import { eventsToClusterSelection, eventToSelection } from "@/lib/wildfire/selection";
import { selectedEventToPolygonGeoJSON } from "@/lib/wildfire/geojson";
import { eventsToTemporalMarkerGeoJSON } from "@/lib/wildfire/temporal";
import { SEVERITY_COLOR } from "@/lib/wildfire/colors";
import type { BasemapMode } from "@/components/ui/BasemapToggle";

// Free, no-API-key vector basemaps from CARTO — dark-matter fits the cinematic
// dark theme, positron is the light-mode counterpart. Attribution is baked
// into the style JSON already.
const STYLE_URL = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;

// Satellite mode keeps one stable, dark vector style for labels and roads.
// Theme changes should only affect the application chrome while imagery is
// visible, otherwise the same satellite view changes under the visitor.
const SATELLITE_STYLE_URL = STYLE_URL.dark;

// Cinematic base: pin the dark style's background to slate-900 rather than
// trusting dark-matter's default near-black, so heatmaps/borders pop consistently.
const DARK_BACKGROUND = "#0f172a";

// Free, no-API-key satellite imagery. It remains a stable instrument surface
// across UI themes; FIRMS overlays and vector labels stay above the raster.
const SATELLITE_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_SOURCE_ID = "satellite-src";
const SATELLITE_LAYER_ID = "satellite-layer";
const SATELLITE_BACKGROUND_LAYER_ID = "satellite-background";
const SATELLITE_BACKGROUND = "#051937";
const SATELLITE_ATTRIBUTION = "© Esri, Maxar, Earthstar Geographics, and the GIS User Community";

const MARKER_LAYER_ID = "fire-markers";
const MARKER_HIT_AREA_LAYER_ID = "fire-marker-hit-area";
const POLYGON_FILL_LAYER_ID = "fire-polygons-fill";
const CLUSTER_LAYER_ID = "major-fire-events";
const CLUSTER_GLOW_LAYER_ID = "major-fire-events-glow";
const CLUSTER_HIT_AREA_LAYER_ID = "major-fire-events-hit-area";
const CLUSTER_COUNT_LAYER_ID = "major-fire-events-count";
const MARKER_SOURCE_ID = "fire-markers-src";
const SELECTED_MARKER_SOURCE_ID = "selected-fire-marker-src";
const SELECTED_MARKER_GLOW_LAYER_ID = "selected-fire-marker-glow";
const SELECTED_MARKER_RING_LAYER_ID = "selected-fire-marker-ring";
// Every layer whose features carry a `fireId` property — clicking or
// hovering any of them (marker, burned-area fill, or heatmap core) selects
// the fire, not just the small marker dot.
const INTERACTIVE_LAYER_IDS = [
  CLUSTER_HIT_AREA_LAYER_ID,
  CLUSTER_LAYER_ID,
  MARKER_HIT_AREA_LAYER_ID,
  MARKER_LAYER_ID,
  POLYGON_FILL_LAYER_ID,
];
const INTERACTION_PRIORITY = [
  CLUSTER_HIT_AREA_LAYER_ID,
  CLUSTER_LAYER_ID,
  MARKER_HIT_AREA_LAYER_ID,
  MARKER_LAYER_ID,
  POLYGON_FILL_LAYER_ID,
] as const;
const POINTER_QUERY_RADIUS = 12;

// Centered on Iberia/the Atlantic rather than the equator — frames Europe,
// North Africa, and the Atlantic on desktop instead of cutting Europe off
// to one side. Also the "Voltar ao mapa global" fly-back target below.
const WORLD_VIEW = { longitude: -9.0, latitude: 39.0, zoom: 3 };
const FIRE_DETAIL_ZOOM = 12;
// A controlled, soft-spring-like flight that keeps the selected point visible
// in the unobstructed map area beside the mission panel.
const FLY_DURATION_MS = 1350;

type InteractiveFeature = NonNullable<MapLayerMouseEvent["features"]>[number];

function pickInteractiveFeature(features: readonly InteractiveFeature[] | undefined): InteractiveFeature | null {
  if (!features || features.length === 0) return null;
  for (const layerId of INTERACTION_PRIORITY) {
    const match = features.find((feature) => feature.layer?.id === layerId);
    if (match) return match;
  }
  return null;
}

function getCameraPadding(panelOpen: boolean): { top: number; right: number; bottom: number; left: number } {
  const isDesktop = window.innerWidth >= 768;
  return {
    top: 88,
    right: isDesktop ? 440 : 24,
    bottom: isDesktop
      ? 56
      : panelOpen
        ? Math.min(Math.round(window.innerHeight * 0.46), Math.max(120, window.innerHeight - 120))
        : 88,
    left: 40,
  };
}

function flyToLocation(
  map: MapLibreMap,
  location: { lng: number; lat: number },
  zoom: number,
  panelOpen: boolean,
): void {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  map.flyTo({
    center: [location.lng, location.lat],
    zoom,
    padding: getCameraPadding(panelOpen),
    duration: reducedMotion ? 0 : FLY_DURATION_MS,
    speed: 0.9,
    curve: 1.42,
    easing: (value) => 1 - ((1 - value) ** 3),
    essential: !reducedMotion,
  });
}

function findHybridAnchor(map: MapLibreMap): string | undefined {
  const layers = map.getStyle().layers ?? [];
  return layers.find((layer) => layer.type === "symbol" || (layer.type === "line" && /boundary|admin/i.test(layer.id)))?.id;
}
function findSatelliteBackgroundAnchor(map: MapLibreMap): string | undefined {
  return map.getStyle().layers?.find((layer) => layer.type !== "background")?.id;
}


function syncSatelliteLayer(map: MapLibreMap, mode: BasemapMode): void {
  if (!map.isStyleLoaded()) return;

  if (mode === "plain") {
    if (map.getLayer(SATELLITE_LAYER_ID)) map.removeLayer(SATELLITE_LAYER_ID);
    if (map.getLayer(SATELLITE_BACKGROUND_LAYER_ID)) map.removeLayer(SATELLITE_BACKGROUND_LAYER_ID);
    if (map.getSource(SATELLITE_SOURCE_ID)) map.removeSource(SATELLITE_SOURCE_ID);
    return;
  }

  if (!map.getLayer(SATELLITE_BACKGROUND_LAYER_ID)) {
    const backgroundAnchor = findSatelliteBackgroundAnchor(map);
    map.addLayer({
      id: SATELLITE_BACKGROUND_LAYER_ID,
      type: "background",
      paint: { "background-color": SATELLITE_BACKGROUND },
    }, backgroundAnchor);
  } else {
    map.setPaintProperty(SATELLITE_BACKGROUND_LAYER_ID, "background-color", SATELLITE_BACKGROUND);
    const backgroundAnchor = findSatelliteBackgroundAnchor(map);
    const layers = map.getStyle().layers ?? [];
    const currentIndex = layers.findIndex((layer) => layer.id === SATELLITE_BACKGROUND_LAYER_ID);
    const anchorIndex = backgroundAnchor ? layers.findIndex((layer) => layer.id === backgroundAnchor) : -1;
    if (backgroundAnchor && currentIndex !== anchorIndex - 1) {
      map.moveLayer(SATELLITE_BACKGROUND_LAYER_ID, backgroundAnchor);
    }
  }

  if (!map.getSource(SATELLITE_SOURCE_ID)) {
    map.addSource(SATELLITE_SOURCE_ID, {
      type: "raster",
      tiles: [SATELLITE_TILE_URL],
      tileSize: 256,
      attribution: SATELLITE_ATTRIBUTION,
    });
  }

  if (!map.getLayer(SATELLITE_LAYER_ID)) {
    map.addLayer({
      id: SATELLITE_LAYER_ID,
      type: "raster",
      source: SATELLITE_SOURCE_ID,
      paint: {
        "raster-brightness-max": 0.64,
        "raster-saturation": -0.28,
        "raster-contrast": 0.16,
        "raster-opacity": 0.88,
      },
    }, findHybridAnchor(map));
  } else {
    const anchor = findHybridAnchor(map);
    const layers = map.getStyle().layers ?? [];
    const currentIndex = layers.findIndex((layer) => layer.id === SATELLITE_LAYER_ID);
    const anchorIndex = anchor ? layers.findIndex((layer) => layer.id === anchor) : -1;
    if (anchor && currentIndex !== anchorIndex - 1) {
      map.moveLayer(SATELLITE_LAYER_ID, anchor);
    }
  }
}

interface FireMapProps {
  events: WildfireEvent[];
  perimeterEvents: WildfireEvent[];
  selectedFire: FireSelection | null;
  onSelect: (selection: FireSelection | null) => void;
  onMapLoad: () => void;
  theme: "dark" | "light";
  basemapMode: BasemapMode;
  countryScope: string;
  timelineHour: number;
}

export default function FireMap({ events, perimeterEvents, selectedFire, onSelect, onMapLoad, theme, basemapMode, countryScope, timelineHour }: FireMapProps) {
  const mapRef = useRef<MapRef>(null);
  const hasReportedMapLoadRef = useRef(false);
  const [isHoveringInteractiveFeature, setIsHoveringInteractiveFeature] = useState(false);

  const selectionRequestRef = useRef(0);
  const polygonData = useMemo(
    () => selectedEventToPolygonGeoJSON(perimeterEvents, selectedFire?.kind === "point" ? selectedFire.id : null),
    [perimeterEvents, selectedFire?.id, selectedFire?.kind],
  );
  const markerData = useMemo(() => eventsToTemporalMarkerGeoJSON(events, timelineHour), [events, timelineHour]);
  const selectedMarkerData: GeoJSON.FeatureCollection = (
    selectedFire?.kind === "point"
      ? {
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            geometry: { type: "Point", coordinates: [selectedFire.location.lng, selectedFire.location.lat] },
            properties: { fireId: selectedFire.id },
          }],
      }
      : { type: "FeatureCollection", features: [] }
  );

  const eventById = useMemo(() => new globalThis.Map(events.map((event) => [event.id, event])), [events]);

  // Updating the raw source data, rather than filtering rendered cluster
  // layers, makes MapLibre rebuild native clusters and point counts for the
  // selected acquisition-time window.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    const source = map?.getSource(MARKER_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(markerData);
  }, [markerData]);

  const handleClick = useCallback(
    async (e: MapLayerMouseEvent) => {
      const requestId = ++selectionRequestRef.current;
      const map = mapRef.current?.getMap();
      const feature = pickInteractiveFeature(e.features) ?? (map
        ? pickInteractiveFeature(map.queryRenderedFeatures([
            [e.point.x - POINTER_QUERY_RADIUS, e.point.y - POINTER_QUERY_RADIUS],
            [e.point.x + POINTER_QUERY_RADIUS, e.point.y + POINTER_QUERY_RADIUS],
          ], { layers: INTERACTIVE_LAYER_IDS }))
        : null);
      if (!feature) {
        onSelect(null);
        return;
      }

      if (feature.properties?.cluster && feature.geometry.type === "Point") {
        const clusterId = Number(feature.properties.cluster_id);
        const pointCount = Number(feature.properties.point_count);
        const source = map?.getSource(MARKER_SOURCE_ID) as GeoJSONSource | undefined;
        if (!source || !Number.isFinite(clusterId) || !Number.isFinite(pointCount)) return;

        try {
          const [leaves, expansionZoom] = await Promise.all([
            source.getClusterLeaves(clusterId, pointCount, 0),
            source.getClusterExpansionZoom(clusterId),
          ]);
          if (selectionRequestRef.current !== requestId) return;
          const members = leaves
            .map((leaf) => eventById.get(String(leaf.properties?.fireId)))
            .filter((event): event is WildfireEvent => Boolean(event));
          const [lng, lat] = feature.geometry.coordinates;
          const selection = eventsToClusterSelection(members, clusterId, { lng, lat });
          if (selection) {
            onSelect(selection);
            if (map) flyToLocation(map, { lng, lat }, Math.min(expansionZoom, FIRE_DETAIL_ZOOM), true);
          }
        } catch (error) {
          console.error("Unable to inspect fire cluster", error);
        }
        return;
      }

      const fireId = String(feature.properties?.fireId ?? "");
      const event = eventById.get(fireId);
      onSelect(event ? eventToSelection(event) : null);
    },
    [eventById, onSelect],
  );

  const handleMove = useCallback((e: MapLayerMouseEvent) => {
    const map = mapRef.current?.getMap();
    const feature = pickInteractiveFeature(e.features) ?? (map
      ? pickInteractiveFeature(map.queryRenderedFeatures([
          [e.point.x - POINTER_QUERY_RADIUS, e.point.y - POINTER_QUERY_RADIUS],
          [e.point.x + POINTER_QUERY_RADIUS, e.point.y + POINTER_QUERY_RADIUS],
        ], { layers: INTERACTIVE_LAYER_IDS }))
      : null);
    setIsHoveringInteractiveFeature(Boolean(feature));
  }, []);

  const applyStyleEnhancements = useCallback((map: MapLibreMap) => {
    if (basemapMode === "plain" && theme === "dark" && map.getLayer("background")) {
      map.setPaintProperty("background", "background-color", DARK_BACKGROUND);
    }
    syncSatelliteLayer(map, basemapMode);
  }, [basemapMode, theme]);

  const handleLoad = useCallback(
    (e: MapLibreEvent) => {
      applyStyleEnhancements(e.target);
      if (!hasReportedMapLoadRef.current) {
        hasReportedMapLoadRef.current = true;
        onMapLoad();
      }
    },
    [applyStyleEnhancements, onMapLoad],
  );

  const handleStyleData = useCallback(
    (e: MapLibreEvent) => {
      if (e.target.isStyleLoaded()) applyStyleEnhancements(e.target);
    },
    [applyStyleEnhancements],
  );

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (map?.isStyleLoaded()) applyStyleEnhancements(map);
  }, [applyStyleEnhancements]);

  // One camera transition per selection identity. Point clicks only update
  // selection here; this effect owns their flight so map and panel selection
  // cannot both animate the camera.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    if (selectedFire?.kind === "cluster") return;
    try {
      if (selectedFire?.kind === "point") {
        flyToLocation(map, selectedFire.location, FIRE_DETAIL_ZOOM, true);
      } else if (countryScope !== "global" && events.length > 0) {
        if (events.length === 1) {
          flyToLocation(map, events[0].location, 7, false);
        } else {
          const lngs = events.map((event) => event.location.lng);
          const lats = events.map((event) => event.location.lat);
          const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          map.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            {
              padding: getCameraPadding(false),
              maxZoom: 7,
              duration: reducedMotion ? 0 : FLY_DURATION_MS,
              essential: !reducedMotion,
            },
          );
        }
      } else {
        flyToLocation(map, { lng: WORLD_VIEW.longitude, lat: WORLD_VIEW.latitude }, WORLD_VIEW.zoom, false);
      }
    } catch {
      // Stale/torn-down map instance — nothing to recover, just skip.
    }
  }, [countryScope, events, selectedFire?.id, selectedFire?.kind, selectedFire?.location]);

  return (
    <div className="wildfire-watch-map-canvas h-full w-full" data-basemap-mode={basemapMode}>
      <Map
      ref={mapRef}
      initialViewState={{ longitude: WORLD_VIEW.longitude, latitude: WORLD_VIEW.latitude, zoom: WORLD_VIEW.zoom }}
      mapStyle={basemapMode === "satellite" ? SATELLITE_STYLE_URL : STYLE_URL[theme]}
      // A globe keeps global anomaly distribution legible at the world view;
      // selected-fire flyTo transitions naturally into the local detail view.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      projection={"globe" as any}
      style={{ width: "100%", height: "100%" }}
      interactiveLayerIds={INTERACTIVE_LAYER_IDS}
      onClick={handleClick}
      onMouseMove={handleMove}
      onMouseLeave={() => setIsHoveringInteractiveFeature(false)}
      cursor={isHoveringInteractiveFeature ? "pointer" : "grab"}
      attributionControl={false}
      onLoad={handleLoad}
      onStyleData={handleStyleData}
    >
      <AttributionControl key={basemapMode} compact position="bottom-left" />
      {/* Satellite raster is managed imperatively beneath vector overlays. */}

      {/* Native clusters replace the former 6,000-point macro heatmap. */}

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

      <Source
        id={MARKER_SOURCE_ID}
        type="geojson"
        data={markerData}
        cluster
        clusterRadius={50}
        clusterMaxZoom={10}
        clusterProperties={{ sumTemporalFrpMw: ["+", ["get", "temporalFrpMw"]] }}
      >
        <Layer
          id={CLUSTER_GLOW_LAYER_ID}
          type="circle"
          filter={["has", "point_count"]}
          paint={{
              "circle-radius": [
              "interpolate", ["linear"], ["get", "sumTemporalFrpMw"],
              0, 16,
              100, 23,
              500, 31,
              2500, 41,
              10000, 52,
            ],
            "circle-color": "#ef4444",
            "circle-opacity": 0.22,
            "circle-blur": 0.55,
          }}
        />
        <Layer
          id={CLUSTER_HIT_AREA_LAYER_ID}
          type="circle"
          filter={["has", "point_count"]}
          paint={{
            "circle-radius": [
              "interpolate", ["linear"], ["get", "sumTemporalFrpMw"],
              0, 16,
              500, 29,
              2500, 39,
              10000, 50,
            ],
            "circle-opacity": 0,
            "circle-stroke-opacity": 0,
          }}
        />
        <Layer
          id={CLUSTER_LAYER_ID}
          type="circle"
          filter={["has", "point_count"]}
          paint={{
            "circle-radius": [
              "interpolate", ["linear"], ["get", "sumTemporalFrpMw"],
              0, 11,
              100, 16,
              500, 23,
              2500, 33,
              10000, 44,
            ],
            "circle-color": [
              "interpolate", ["linear"], ["get", "sumTemporalFrpMw"],
              0, "#f5c451",
              250, "#f59e0b",
              1000, "#ef4444",
              5000, "#b91c1c",
            ],
            "circle-opacity": 0.92,
            "circle-stroke-color": "rgba(255,255,255,0.9)",
            "circle-stroke-width": 2,
          }}
        />
        <Layer
          id={CLUSTER_COUNT_LAYER_ID}
          type="symbol"
          filter={["has", "point_count"]}
          layout={{
            "text-field": ["get", "point_count_abbreviated"],
            "text-size": 12,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }}
          paint={{
            "text-color": "#ffffff",
            "text-halo-color": "rgba(15,23,42,0.75)",
            "text-halo-width": 1,
          }}
        />

        <Layer
          id={MARKER_HIT_AREA_LAYER_ID}
          type="circle"
          filter={["!", ["has", "point_count"]]}
          paint={{ "circle-radius": 22, "circle-opacity": 0, "circle-stroke-opacity": 0 }}
        />
        <Layer
          id={MARKER_LAYER_ID}
          type="circle"
          filter={["!", ["has", "point_count"]]}
          paint={{
            "circle-radius": [
              "*",
              [
                "case",
                ["==", ["get", "fireId"], selectedFire?.kind === "point" ? selectedFire.id : ""], 11,
                7,
              ],
              ["coalesce", ["get", "temporalRadiusScale"], 1],
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
              ["==", ["get", "fireId"], selectedFire?.kind === "point" ? selectedFire.id : ""], 3,
              1.5,
            ],
            "circle-stroke-color": "#ffffff",
            "circle-opacity": ["coalesce", ["get", "temporalOpacity"], 1],
          }}
        />
      </Source>

      {/* This source is intentionally separate from the filtered, clustered
          marker source so selection stays visible during timeline playback. */}
      <Source id={SELECTED_MARKER_SOURCE_ID} type="geojson" data={selectedMarkerData}>
        <Layer
          id={SELECTED_MARKER_GLOW_LAYER_ID}
          type="circle"
          paint={{
            "circle-radius": 19,
            "circle-color": "#ef4444",
            "circle-opacity": 0.16,
            "circle-blur": 0.7,
          }}
        />
        <Layer
          id={SELECTED_MARKER_RING_LAYER_ID}
          type="circle"
          paint={{
            "circle-radius": 15,
            "circle-color": "rgba(239,68,68,0.08)",
            "circle-opacity": 0.9,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 3,
          }}
        />
      </Source>
      </Map>
    </div>
  );
}
