"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Map, { AttributionControl, Layer, ScaleControl, Source, type MapLayerMouseEvent, type MapRef } from "react-map-gl/maplibre";
import type { AddLayerObject, FilterSpecification, GeoJSONSource, Map as MapLibreMap, MapLibreEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FireSelection, WildfireEvent } from "@/lib/wildfire/types";
import { eventsToClusterSelection, eventToSelection } from "@/lib/wildfire/selection";
import { eventsToTemporalMarkerGeoJSON } from "@/lib/wildfire/temporal";
import { eventsToViirsPixelGeoJSON } from "@/lib/wildfire/viirs";
import { SEVERITY_COLOR } from "@/lib/wildfire/colors";
import type { BasemapMode } from "@/components/ui/BasemapToggle";
import {
  DARK_BACKGROUND,
  SATELLITE_BACKGROUND,
  getCameraPadding as getMapCameraPadding,
  getMapStyleUrl,
  getSatelliteLayerPlan,
  observeStyleReady,
} from "./mapPresentation";

// Free, no-API-key vector basemaps from CARTO — dark-matter fits the cinematic
// dark theme, positron is the light-mode counterpart. Attribution is baked
// into the style JSON already.
// Free, no-API-key satellite imagery. It remains a stable instrument surface
// across UI themes; FIRMS overlays and vector labels stay above the raster.
const SATELLITE_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_SOURCE_ID = "satellite-src";
const SATELLITE_LAYER_ID = "satellite-layer";
const SATELLITE_BACKGROUND_LAYER_ID = "satellite-background";
const SATELLITE_OCEAN_MASK_LAYER_ID = "satellite-ocean-mask";
const SATELLITE_ATTRIBUTION = "© Esri, Maxar, Earthstar Geographics, and the GIS User Community";

const MARKER_LAYER_ID = "fire-markers";
const MARKER_HIT_AREA_LAYER_ID = "fire-marker-hit-area";
const CLUSTER_LAYER_ID = "major-fire-events";
const CLUSTER_GLOW_LAYER_ID = "major-fire-events-glow";
const CLUSTER_HIT_AREA_LAYER_ID = "major-fire-events-hit-area";
const CLUSTER_COUNT_LAYER_ID = "major-fire-events-count";
const MARKER_SOURCE_ID = "fire-markers-src";
const SELECTED_PIXEL_SOURCE_ID = "selected-viirs-pixels-src";
const SELECTED_PIXEL_FILL_LAYER_ID = "selected-viirs-pixels-fill";
const SELECTED_PIXEL_BORDER_LAYER_ID = "selected-viirs-pixels-border";
// Cluster and marker hit areas retain broad pointer targets while selected
// detections render separately as sensor-sized polygons.
const INTERACTIVE_LAYER_IDS = [
  CLUSTER_HIT_AREA_LAYER_ID,
  CLUSTER_LAYER_ID,
  MARKER_HIT_AREA_LAYER_ID,
  MARKER_LAYER_ID,
];
const INTERACTION_PRIORITY = [
  CLUSTER_HIT_AREA_LAYER_ID,
  CLUSTER_LAYER_ID,
  MARKER_HIT_AREA_LAYER_ID,
  MARKER_LAYER_ID,
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

function getUnselectedMarkerFilter(selectedEventIds: readonly string[]): FilterSpecification {
  if (selectedEventIds.length === 0) return ["!", ["has", "point_count"]];

  return [
    "all",
    ["!", ["has", "point_count"]],
    ["!", ["in", ["get", "fireId"], ["literal", [...selectedEventIds]]]],
  ];
}

function getCameraPadding(panelOpen: boolean) {
  return getMapCameraPadding({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    panelOpen,
  });
}

function flyToLocation(
  map: MapLibreMap,
  location: { lng: number; lat: number },
  zoom: number,
  panelOpen: boolean,
): void {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const padding = getCameraPadding(panelOpen);
  writeMapCameraState(map, padding, "flyTo");
  map.flyTo({
    center: [location.lng, location.lat],
    zoom,
    padding,
    duration: reducedMotion ? 0 : FLY_DURATION_MS,
    speed: 0.9,
    curve: 1.42,
    easing: (value) => 1 - ((1 - value) ** 3),
    essential: !reducedMotion,
  });
}

function moveLayerBefore(map: MapLibreMap, layerId: string, beforeLayerId: string | undefined): void {
  if (!beforeLayerId || !map.getLayer(layerId)) return;
  const layers = map.getStyle().layers ?? [];
  const currentIndex = layers.findIndex((layer) => layer.id === layerId);
  const beforeIndex = layers.findIndex((layer) => layer.id === beforeLayerId);
  if (currentIndex !== -1 && beforeIndex !== -1 && currentIndex !== beforeIndex - 1) {
    map.moveLayer(layerId, beforeLayerId);
  }
}

function writeMapCameraState(
  map: MapLibreMap,
  padding: { top: number; right: number; bottom: number; left: number },
  action: "flyTo" | "fitBounds",
): void {
  const mapRoot = map.getContainer().closest<HTMLElement>("[data-map-style-url]");
  mapRoot?.setAttribute("data-map-camera-padding", JSON.stringify(padding));
  mapRoot?.setAttribute("data-map-camera-action", action);
}

function syncSatelliteLayer(map: MapLibreMap, mode: BasemapMode): void {
  if (mode === "plain") {
    if (map.getLayer(SATELLITE_LAYER_ID)) map.removeLayer(SATELLITE_LAYER_ID);
    if (map.getLayer(SATELLITE_OCEAN_MASK_LAYER_ID)) map.removeLayer(SATELLITE_OCEAN_MASK_LAYER_ID);
    if (map.getLayer(SATELLITE_BACKGROUND_LAYER_ID)) map.removeLayer(SATELLITE_BACKGROUND_LAYER_ID);
    if (map.getSource(SATELLITE_SOURCE_ID)) map.removeSource(SATELLITE_SOURCE_ID);
    return;
  }

  const initialPlan = getSatelliteLayerPlan(map.getStyle().layers ?? []);
  if (!map.getLayer(SATELLITE_BACKGROUND_LAYER_ID)) {
    map.addLayer({
      id: SATELLITE_BACKGROUND_LAYER_ID,
      type: "background",
      paint: { "background-color": SATELLITE_BACKGROUND },
    }, initialPlan.backgroundBeforeLayerId);
  } else {
    map.setPaintProperty(SATELLITE_BACKGROUND_LAYER_ID, "background-color", SATELLITE_BACKGROUND);
  }
  moveLayerBefore(map, SATELLITE_BACKGROUND_LAYER_ID, initialPlan.backgroundBeforeLayerId);

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
    }, getSatelliteLayerPlan(map.getStyle().layers ?? []).overlayBeforeLayerId);
  } else {
    moveLayerBefore(
      map,
      SATELLITE_LAYER_ID,
      getSatelliteLayerPlan(map.getStyle().layers ?? []).overlayBeforeLayerId,
    );
  }

  const layerPlan = getSatelliteLayerPlan(map.getStyle().layers ?? []);
  if (layerPlan.oceanLayer) {
    const oceanMask: AddLayerObject = {
      id: SATELLITE_OCEAN_MASK_LAYER_ID,
      type: "fill",
      source: layerPlan.oceanLayer.source,
      ...(layerPlan.oceanLayer.sourceLayer ? { "source-layer": layerPlan.oceanLayer.sourceLayer } : {}),
      ...(layerPlan.oceanLayer.filter !== undefined
        ? { filter: layerPlan.oceanLayer.filter as FilterSpecification }
        : {}),
      paint: {
        "fill-color": SATELLITE_BACKGROUND,
        "fill-opacity": 1,
      },
    };
    if (!map.getLayer(SATELLITE_OCEAN_MASK_LAYER_ID)) {
      map.addLayer(oceanMask, layerPlan.overlayBeforeLayerId);
    } else {
      map.setPaintProperty(SATELLITE_OCEAN_MASK_LAYER_ID, "fill-color", SATELLITE_BACKGROUND);
      map.setPaintProperty(SATELLITE_OCEAN_MASK_LAYER_ID, "fill-opacity", 1);
      if (layerPlan.oceanLayer.filter !== undefined) {
        map.setFilter(SATELLITE_OCEAN_MASK_LAYER_ID, layerPlan.oceanLayer.filter as FilterSpecification);
      }
      moveLayerBefore(map, SATELLITE_OCEAN_MASK_LAYER_ID, layerPlan.overlayBeforeLayerId);
    }
  } else if (map.getLayer(SATELLITE_OCEAN_MASK_LAYER_ID)) {
    map.removeLayer(SATELLITE_OCEAN_MASK_LAYER_ID);
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
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);
  const [isHoveringInteractiveFeature, setIsHoveringInteractiveFeature] = useState(false);

  const selectionRequestRef = useRef(0);
  const selectedFireEventIds = selectedFire?.eventIds;
  const selectedPixelData = useMemo(
    () => selectedFireEventIds
      ? eventsToViirsPixelGeoJSON(perimeterEvents, selectedFireEventIds)
      : { type: "FeatureCollection" as const, features: [] },
    [perimeterEvents, selectedFireEventIds],
  );
  const markerData = useMemo(() => eventsToTemporalMarkerGeoJSON(events, timelineHour), [events, timelineHour]);

  const eventById = useMemo(() => new globalThis.Map(events.map((event) => [event.id, event])), [events]);
  const mapStyleUrl = getMapStyleUrl(theme, basemapMode);

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
    if (basemapMode === "plain" && map.getLayer("background")) {
      map.setPaintProperty("background", "background-color", theme === "dark" ? DARK_BACKGROUND : "#f5f6f7");
    }
    syncSatelliteLayer(map, basemapMode);
  }, [basemapMode, theme]);

  const handleLoad = useCallback(
    (e: MapLibreEvent) => {
      setMapInstance(e.target);
      applyStyleEnhancements(e.target);
      if (!hasReportedMapLoadRef.current) {
        hasReportedMapLoadRef.current = true;
        onMapLoad();
      }
    },
    [applyStyleEnhancements, onMapLoad],
  );

  useEffect(() => {
    if (!mapInstance) return;
    return observeStyleReady(mapInstance, () => applyStyleEnhancements(mapInstance));
  }, [applyStyleEnhancements, mapInstance, mapStyleUrl]);

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
          flyToLocation(map, events[0].location, 7, true);
        } else {
          const lngs = events.map((event) => event.location.lng);
          const lats = events.map((event) => event.location.lat);
          const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          const padding = getCameraPadding(true);
          writeMapCameraState(map, padding, "fitBounds");
          map.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            {
              padding,
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
    <div
      className="wildfire-watch-map-canvas h-full w-full"
      data-basemap-mode={basemapMode}
      data-map-style-theme={basemapMode === "satellite" ? "satellite" : theme}
      data-map-style-url={mapStyleUrl}
    >
      <Map
      ref={mapRef}
      initialViewState={{ longitude: WORLD_VIEW.longitude, latitude: WORLD_VIEW.latitude, zoom: WORLD_VIEW.zoom }}
      mapStyle={mapStyleUrl}
      styleDiffing={false}
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
    >
      <AttributionControl key={basemapMode} compact position="bottom-left" />
      <ScaleControl position="bottom-right" unit="metric" />
      {/* Satellite raster is managed imperatively beneath vector overlays. */}

      {/* Native clusters replace the former 6,000-point macro heatmap. */}

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
          filter={getUnselectedMarkerFilter(selectedFireEventIds ?? [])}
          paint={{
            "circle-radius": [
              "*",
              7,
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
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": ["coalesce", ["get", "temporalOpacity"], 1],
          }}
        />
      </Source>

      {/* Selected raw detections become native VIIRS footprints. This source
          is separate from the timeline-filtered marker source so the grid
          remains visible while the global chronology is scrubbed. */}
      <Source id={SELECTED_PIXEL_SOURCE_ID} type="geojson" data={selectedPixelData}>
        <Layer
          id={SELECTED_PIXEL_FILL_LAYER_ID}
          type="fill"
          paint={{
            "fill-color": [
              "interpolate", ["linear"], ["coalesce", ["get", "frp"], 0],
              0, "#fffef3",
              30, "#fff0a3",
              31, "#ff8a00",
              79, "#ff7800",
              80, "#dc143c",
              150, "#7f1d1d",
            ],
            "fill-opacity": 0.9,
            "fill-antialias": false,
          }}
        />
        <Layer
          id={SELECTED_PIXEL_BORDER_LAYER_ID}
          type="line"
          paint={{
            "line-color": "rgba(10, 13, 18, 0.88)",
            "line-width": 1,
            "line-opacity": 0.8,
          }}
        />
      </Source>
      </Map>
    </div>
  );
}
