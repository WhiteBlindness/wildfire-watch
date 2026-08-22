"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Map, { AttributionControl, Layer, ScaleControl, Source, type MapLayerMouseEvent, type MapRef } from "react-map-gl/maplibre";
import type { FilterSpecification, GeoJSONSource, Map as MapLibreMap, MapLibreEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FireSelection, WildfireEvent } from "@/lib/wildfire/types";
import { eventsToClusterSelection, eventToSelection } from "@/lib/wildfire/selection";
import { eventsToTemporalMarkerGeoJSON } from "@/lib/wildfire/temporal";
import { pointsToViirsPixelGeoJSON } from "@/lib/wildfire/viirs";
import { eventsToDensityPoints, pointsToThermalDensityGeoJSON } from "@/lib/wildfire/density";
import { buildGeographyLabelGeoJSON } from "@/lib/geography";
import { fetchFireDetailPoints } from "@/lib/wildfire/firms-adapter";
import type { CachedFirmsPoint } from "@/lib/wildfire/firms-cache";
import { SEVERITY_COLOR } from "@/lib/wildfire/colors";
import type { BasemapMode } from "@/components/ui/BasemapToggle";
import {
  getBackdropColor,
  getCameraPadding as getMapCameraPadding,
  getMapStyleUrl,
  getWaterColorOverrides,
  observeStyleReady,
  computeDetailCameraTarget,
} from "./mapPresentation";
import { syncSatelliteLayers } from "./satelliteLayers";

// Free, no-API-key vector basemaps from CARTO — dark-matter fits the cinematic
// dark theme, positron is the light-mode counterpart. Attribution is baked
// into the style JSON already.
const MARKER_LAYER_ID = "fire-markers";
const MARKER_HIT_AREA_LAYER_ID = "fire-marker-hit-area";
const CLUSTER_LAYER_ID = "major-fire-events";
const CLUSTER_GLOW_LAYER_ID = "major-fire-events-glow";
const CLUSTER_HIT_AREA_LAYER_ID = "major-fire-events-hit-area";
const CLUSTER_COUNT_LAYER_ID = "major-fire-events-count";
const MARKER_SOURCE_ID = "fire-markers-src";
const DENSITY_SOURCE_ID = "thermal-density-src";
const DENSITY_HEATMAP_LAYER_ID = "thermal-density-heatmap";
const FOOTPRINT_SOURCE_ID = "viirs-footprint-src";
const FOOTPRINT_OUTLINE_LAYER_ID = "viirs-footprint-outline";
const GEOGRAPHY_SOURCE_ID = "geography-labels-src";
const GEOGRAPHY_LAYER_PREFIX = "geography-label-tier-";

// The zoom at or above which individual 375 m sensor footprints are revealed as
// a thin outline beneath the density field — honest instrumentation for
// advanced users, not the primary representation.
const FOOTPRINT_MIN_ZOOM = 14;

// The density heatmap draws from this zoom up. It is intentionally BELOW the
// marker handover (VIIRS_MOSAIC_MIN_ZOOM = 11) so a selected fire's field stays
// visible wherever the detail-arrival camera fit lands — that fit can frame a
// wide burn between zoom 5 and 12 (DETAIL_MOSAIC_MIN/MAX_ZOOM), which would
// otherwise fall into a dead band below 11 where both the field and the
// (deliberately excluded) selected marker are hidden. This does NOT produce a
// global low-zoom blur: the snapshot-wide density path self-gates on
// mosaicBounds, which is null below zoom 11, so with no selection nothing draws
// here and the clusters still own the low zooms.
const DENSITY_MIN_ZOOM = 5;

// Empty collections reused as stable identities so a memo that produces "nothing
// to draw" never allocates a fresh object and forces a needless source update.
const EMPTY_POINT_FC: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: "FeatureCollection", features: [] };
const EMPTY_FOOTPRINT_FC: GeoJSON.FeatureCollection<GeoJSON.Geometry> = { type: "FeatureCollection", features: [] };

// Physical-geography labels (mountain ranges, peaks, volcanoes) are static and
// international; build the label FeatureCollection once at module load. Each
// feature carries a per-feature minZoom so it can be assigned to the matching
// zoom tier below. See src/lib/geography.
const GEOGRAPHY_LABELS = buildGeographyLabelGeoJSON();
// Distinct integer minZoom tiers present in the data. One symbol layer per tier
// (each with its own layer-level minzoom) reproduces per-feature zoom gating,
// which MapLibre filters cannot express because ["zoom"] is disallowed there.
const GEOGRAPHY_TIERS = [...new Set(GEOGRAPHY_LABELS.features.map((f) => f.properties.minZoom))].sort((a, b) => a - b);
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

/**
 * The single zoom at which the map hands over from the circular marker
 * presentation to the VIIRS square mosaic. Circles draw strictly below it, the
 * mosaic strictly at or above it, so the two are mutually exclusive and can
 * never overlap — a round dot sitting in the middle of the footprint grid is
 * exactly the artefact this threshold exists to prevent.
 *
 * Why 11? A 375 m footprint is roughly 3 px at zoom 10, 6 px at zoom 11 and
 * 13 px at zoom 12 at mid latitudes, so the grid only reads as a matrix rather
 * than noise from about zoom 11. It also sits above clusterMaxZoom (10), so
 * clusters have already dissolved into individual markers before the handover
 * and the transition is a single visual step rather than two.
 *
 * Enforcement is declarative, through each layer's minzoom/maxzoom, so the swap
 * is frame-accurate and costs no React re-render. MapLibre draws a layer while
 * minzoom <= zoom < maxzoom, so sharing one constant makes the boundary exact.
 */
const VIIRS_MOSAIC_MIN_ZOOM = 11;

// Footprints are built only for detections inside the viewport, because a
// geodesic buffer per detection is far too costly to run across a whole global
// snapshot when almost none of it is on screen. Measured: 5 954 detections cost
// ~209 ms, while a zoom-11 viewport typically holds tens.
//
// The margin keeps footprints present just outside the frame so a short pan does
// not reveal an empty edge before the recompute lands. Bounds are snapped to a
// coarse grid so ordinary panning reuses the previous result rather than
// rebuilding the geometry on every gesture.
const MOSAIC_VIEWPORT_MARGIN_DEG = 0.08;
const MOSAIC_VIEWPORT_SNAP_DEG = 0.05;
const MOSAIC_VIEWPORT_DEBOUNCE_MS = 180;

type MosaicBounds = readonly [number, number, number, number];

/** Snaps outward to a coarse grid so small pans yield an unchanged key. */
function snapMosaicBounds(west: number, south: number, east: number, north: number): MosaicBounds {
  const floor = (value: number) => Math.floor(value / MOSAIC_VIEWPORT_SNAP_DEG) * MOSAIC_VIEWPORT_SNAP_DEG;
  const ceil = (value: number) => Math.ceil(value / MOSAIC_VIEWPORT_SNAP_DEG) * MOSAIC_VIEWPORT_SNAP_DEG;
  return [
    floor(west - MOSAIC_VIEWPORT_MARGIN_DEG),
    floor(south - MOSAIC_VIEWPORT_MARGIN_DEG),
    ceil(east + MOSAIC_VIEWPORT_MARGIN_DEG),
    ceil(north + MOSAIC_VIEWPORT_MARGIN_DEG),
  ];
}

// Detail bbox parameters — how much padding to add around an event's
// coordinates when computing the fetch bbox. This keeps the VIIRS mosaic from
// being clipped at the event boundary. Kept well under the route's 5° cap.
const DETAIL_BBOX_MARGIN_DEG = 0.15;
// Minimum half-span so a single-point fire still gets a real bbox, not a
// degenerate zero-width box that the route rejects.
const DETAIL_BBOX_MIN_HALF_SPAN_DEG = 0.15;
// Route caps each axis at 5°; stay safely below that.
const DETAIL_BBOX_MAX_HALF_SPAN_DEG = 2.4;

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

function writeMapCameraState(
  map: MapLibreMap,
  padding: { top: number; right: number; bottom: number; left: number },
  action: "flyTo" | "fitBounds" | "fitToDetail",
): void {
  const mapRoot = map.getContainer().closest<HTMLElement>("[data-map-style-url]");
  mapRoot?.setAttribute("data-map-camera-padding", JSON.stringify(padding));
  mapRoot?.setAttribute("data-map-camera-action", action);
}

/**
 * Derives a detail fetch bbox from the events that belong to the selection.
 * For clusters the bbox spans the actual event coordinates plus a margin;
 * for single-point selections a minimum half-span is enforced so the box is
 * never degenerate. All values are clamped to valid WGS-84 ranges and the
 * maximum span is kept under the route's 5° cap.
 */
function buildDetailBbox(
  selectedEventIds: readonly string[],
  allEvents: WildfireEvent[],
): [number, number, number, number] {
  const selectedIds = new Set(selectedEventIds);
  const coords = allEvents
    .filter((event) => selectedIds.has(event.id))
    .map((event) => ({ lng: event.location.lng, lat: event.location.lat }));

  const lngs = coords.map((c) => c.lng);
  const lats = coords.map((c) => c.lat);

  const minLng = lngs.length > 0 ? Math.min(...lngs) : 0;
  const maxLng = lngs.length > 0 ? Math.max(...lngs) : 0;
  const minLat = lats.length > 0 ? Math.min(...lats) : 0;
  const maxLat = lats.length > 0 ? Math.max(...lats) : 0;

  // Half-span: the larger of (data extent / 2 + margin) or the minimum.
  const halfSpanLng = Math.min(
    Math.max((maxLng - minLng) / 2 + DETAIL_BBOX_MARGIN_DEG, DETAIL_BBOX_MIN_HALF_SPAN_DEG),
    DETAIL_BBOX_MAX_HALF_SPAN_DEG,
  );
  const halfSpanLat = Math.min(
    Math.max((maxLat - minLat) / 2 + DETAIL_BBOX_MARGIN_DEG, DETAIL_BBOX_MIN_HALF_SPAN_DEG),
    DETAIL_BBOX_MAX_HALF_SPAN_DEG,
  );

  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;

  return [
    Math.max(-180, centerLng - halfSpanLng),
    Math.max(-90, centerLat - halfSpanLat),
    Math.min(180, centerLng + halfSpanLng),
    Math.min(90, centerLat + halfSpanLat),
  ];
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
  // Tracks whether the viewport is zoomed in past CLUSTER_SUPPRESS_ZOOM_THRESHOLD.
  // Stored as a boolean — not raw zoom — so a zoom event only triggers a
  // re-render when the threshold is actually crossed, never on every frame.
  // Initialised false: the world view starts at zoom 3 (well below the threshold).
  // Snapped viewport the snapshot mosaic is currently built for. null below the
  // handover zoom, where the mosaic is not drawn and the geometry would be
  // wasted work.
  const [mosaicBounds, setMosaicBounds] = useState<MosaicBounds | null>(null);

  // Tracks click-handler request IDs to guard cluster-leaf async operations.
  const selectionRequestRef = useRef(0);
  // Separate counter for the detail fetch so it doesn't interfere with the
  // cluster-leaf request counter in handleClick.
  const detailFetchCounterRef = useRef(0);
  // Set to true when the user makes a deliberate pan or zoom gesture AFTER a
  // selection is active. This prevents the detail-arrival camera fit from
  // yanking the camera away from somewhere the user intentionally navigated to.
  // Reset to false whenever a new selection starts (the immediate flyTo IS the
  // intention, so the subsequent fit should still run).
  const userPannedAwayRef = useRef(false);

  const selectedFireEventIds = selectedFire?.eventIds;

  // Low-resolution thermal-density field derived from the globally-downsampled
  // perimeterEvents snapshot for the selected fire. Shown immediately on
  // selection and kept as a fallback if the full-resolution fetch fails. This
  // is a smooth GPU density field, NOT a measured perimeter — see density.ts
  // for the weight model (FRP × recency × confidence).
  const lowResDensityData = useMemo(
    () => {
      if (!selectedFireEventIds || selectedFireEventIds.length === 0) {
        return EMPTY_POINT_FC;
      }
      const selectedIds = new Set(selectedFireEventIds);
      return pointsToThermalDensityGeoJSON(
        eventsToDensityPoints(perimeterEvents.filter((event) => selectedIds.has(event.id))),
      );
    },
    [perimeterEvents, selectedFireEventIds],
  );

  // Above the handover zoom the field must stand on its own, because the
  // circles are gone and the map would otherwise be empty for anyone who has
  // not tapped a fire. Derive a density point for every visible detection from
  // the snapshot so the field is a function of zoom, not of selection state.
  //
  // Scoped to mosaicBounds so the source stays small over a dense country.
  // Unlike the former square mosaic, density needs NO per-detection geodesic
  // buffer, so this path is far cheaper than the ~209 ms footprint build it
  // replaces — the viewport scoping is now just source-size hygiene, not a
  // hard performance requirement.
  const snapshotDensityData = useMemo(
    () => {
      if (!mosaicBounds) return EMPTY_POINT_FC;
      const [west, south, east, north] = mosaicBounds;
      const inView = events.filter((event) => {
        const { lng, lat } = event.location;
        return lng >= west && lng <= east && lat >= south && lat <= north;
      });
      return pointsToThermalDensityGeoJSON(eventsToDensityPoints(inView));
    },
    [events, mosaicBounds],
  );

  // Full-resolution detections fetched from /api/fires/detail. null means
  // "not yet loaded or selection cleared".
  const [detailPoints, setDetailPoints] = useState<CachedFirmsPoint[] | null>(null);

  // Full-resolution density field for the selected fire (the primary organic
  // representation at close zoom).
  const detailDensityData = useMemo(
    () => detailPoints ? pointsToThermalDensityGeoJSON(detailPoints) : null,
    [detailPoints],
  );

  // Full-resolution native VIIRS footprints, kept ONLY for the very-close-zoom
  // outline layer (honest sensor instrumentation) and for camera framing.
  const detailPixelData = useMemo(
    () => detailPoints ? pointsToViirsPixelGeoJSON(detailPoints) : null,
    [detailPoints],
  );

  // Densest available wins: the full-resolution field for the selected fire,
  // else that fire's low-res field while the fetch is in flight or after a
  // failure, else the snapshot-wide field so zooming in always shows activity.
  const densityData = detailDensityData
    ?? (lowResDensityData.features.length > 0 ? lowResDensityData : snapshotDensityData);

  // Thin 375 m footprint outlines, drawn only from full-resolution detail at
  // very close zoom as subtle instrumentation beneath the density field.
  const footprintData = detailPixelData ?? EMPTY_FOOTPRINT_FC;

  const markerData = useMemo(() => eventsToTemporalMarkerGeoJSON(events, timelineHour), [events, timelineHour]);

  const eventById = useMemo(() => new globalThis.Map(events.map((event) => [event.id, event])), [events]);
  const mapStyleUrl = getMapStyleUrl(theme, basemapMode);

  // Fetch full-resolution VIIRS detections whenever the selection changes.
  // Keyed on selectedFire.id so stable references don't trigger spurious
  // re-fetches when the parent re-renders with the same selection identity.
  useEffect(() => {
    // Clear detail data immediately so A→B transitions don't briefly show A's
    // dense pixels at B's location while the fetch is in flight.
    setDetailPoints(null);
    // A new selection starts: the immediate flyTo IS intentional, so reset the
    // pan-away guard so the mosaic-fit still runs when the data arrives.
    userPannedAwayRef.current = false;

    if (!selectedFire || !selectedFireEventIds || selectedFireEventIds.length === 0) return;

    const fetchId = ++detailFetchCounterRef.current;
    const controller = new AbortController();

    const bbox = buildDetailBbox(selectedFireEventIds, [...perimeterEvents, ...events]);

    // Anchor the fetch window to the fire's own detection time so stale
    // snapshot fires (whose detections may be days or weeks in the past) are
    // bracketed by the correct NRT window rather than the rolling "most recent
    // N days from now" default, which returns 0 points for any fire that is
    // no longer burning within the last few days.
    //
    // Strategy: start = detectedAt − 1 day (UTC), days = 3.
    // The detection sits roughly in the middle of the window (day 2 of 3),
    // which is preferable to placing it on the window boundary where a
    // one-second rounding error could exclude it entirely.
    //
    // Edge cases:
    //   - Missing / unparseable timestamp → fall back to rolling window
    //     (omit start; the API default applies).
    //   - Computed start is in the future (possible if clock skew or
    //     snapshot generatedAt > wall clock) → omit start; rolling window is
    //     safer than a 400 from the route.
    const detailStart = ((): string | undefined => {
      const raw = selectedFire.detectedAt;
      if (!raw) return undefined;
      const detectedMs = new Date(raw).getTime();
      if (!Number.isFinite(detectedMs)) return undefined;
      // Subtract one full day so the detection is mid-window, not on its edge.
      const startMs = detectedMs - 24 * 60 * 60 * 1_000;
      if (startMs > Date.now()) return undefined;
      // Format as YYYY-MM-DD in UTC — using local time near midnight would
      // silently shift the date by one day.
      return new Date(startMs).toISOString().slice(0, 10);
    })();

    (async () => {
      try {
        const points = await fetchFireDetailPoints(bbox, { days: 3, start: detailStart, signal: controller.signal });
        // Guard against out-of-order responses from rapid re-selections.
        if (detailFetchCounterRef.current !== fetchId) return;
        setDetailPoints(points);
      } catch (error) {
        // An abort is expected when the selection changes or the component
        // unmounts — it is not a real failure, so log nothing.
        if (error instanceof Error && error.name === "AbortError") return;
        // Guard stale responses even in the error path.
        if (detailFetchCounterRef.current !== fetchId) return;
        // Real fetch/parse failure — keep the low-res fallback (detailPoints
        // stays null from the setDetailPoints(null) call above) and surface
        // the error so it's visible during debugging.
        console.error("Fire detail fetch failed; keeping low-resolution fallback.", error);
      }
    })();

    return () => {
      // Cancel the in-flight request so a rapid re-selection doesn't get
      // two concurrent fetches racing to set state.
      controller.abort();
    };
    // Intentionally omit perimeterEvents and events from deps — the bbox
    // snapshot is computed once per selection identity and updated only when
    // the fire changes, matching the user's expected interaction model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFire?.id]);

  // Track when the user deliberately pans or zooms away after a selection.
  // MapLibre sets e.originalEvent only for genuine pointer/touch/wheel gestures
  // (not for programmatic flyTo/fitBounds). When we detect such a gesture, we
  // mark the pan-away guard so the detail-arrival fit does not yank the camera
  // back to the burn scar.
  useEffect(() => {
    const map = mapRef.current?.getMap() ?? mapInstance;
    if (!map) return;

    function onUserGesture(e: { originalEvent?: Event }): void {
      if (e.originalEvent) {
        userPannedAwayRef.current = true;
      }
    }

    map.on("movestart", onUserGesture);
    map.on("zoomstart", onUserGesture);
    return () => {
      map.off("movestart", onUserGesture);
      map.off("zoomstart", onUserGesture);
    };
  }, [mapInstance]);

  // Track whether the viewport is zoomed past CLUSTER_SUPPRESS_ZOOM_THRESHOLD
  // so cluster suppression can be zoom-aware rather than selection-only.
  //
  // Uses "zoom" (fires during the zoom animation on every frame) rather than
  // "zoomend" alone so the threshold crossing is caught mid-flight — relevant
  // when the programmatic flyTo to a selected fire crosses the threshold before
  // the animation completes. The flip-guard (next !== current) keeps re-renders
  // to exactly one per threshold crossing, never once per animation frame.
  //
  // Deliberately does NOT gate on e.originalEvent: both user gestures AND
  // programmatic flyTo (e.g. selecting a fire) must engage suppression, because
  // the selection flyTo to FIRE_DETAIL_ZOOM = 12 crosses the threshold too.
  useEffect(() => {
    const mapOrNull: MapLibreMap | null = mapRef.current?.getMap() ?? mapInstance;
    if (!mapOrNull) return;
    // Capture as a non-nullable const so TypeScript can narrow inside the
    // closure (flow narrowing does not propagate through function boundaries).
    const map = mapOrNull;

    let debounceId: number | undefined;

    function syncMosaicBounds(): void {
      // Below the handover zoom the mosaic is not drawn, so drop the bounds and
      // let the memo collapse to an empty collection instead of holding stale
      // geometry for a viewport nobody is looking at.
      if (map.getZoom() < VIIRS_MOSAIC_MIN_ZOOM) {
        setMosaicBounds((current) => (current === null ? current : null));
        return;
      }

      const bounds = map.getBounds();
      const next = snapMosaicBounds(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth());
      setMosaicBounds((current) => (
        current
          && current[0] === next[0]
          && current[1] === next[1]
          && current[2] === next[2]
          && current[3] === next[3]
          ? current
          : next
      ));
    }

    function onMoveEnd(): void {
      window.clearTimeout(debounceId);
      debounceId = window.setTimeout(syncMosaicBounds, MOSAIC_VIEWPORT_DEBOUNCE_MS);
    }

    map.on("zoom", onMoveEnd);
    map.on("moveend", onMoveEnd);
    syncMosaicBounds();
    return () => {
      window.clearTimeout(debounceId);
      map.off("zoom", onMoveEnd);
      map.off("moveend", onMoveEnd);
    };
  }, [mapInstance]);

  // When the full-resolution mosaic arrives, re-frame the camera to the actual
  // extent of the burn scar instead of the fixed zoom-12 single-point view.
  // This corrects the defect where FIRE_DETAIL_ZOOM centres on a single
  // detection and may miss the rest of the 323-pixel mosaic entirely.
  //
  // Guards:
  //   1. detailFetchCounterRef: the fetch-generation guard already ensures
  //      detailPoints belongs to the current selection (not a stale response).
  //   2. userPannedAwayRef: skip the fit if the user navigated away after
  //      selecting — the pan-away guard honours the user's deliberate view.
  //   3. No map: the map may still be mounting.
  useEffect(() => {
    if (!detailPixelData) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (userPannedAwayRef.current) return;

    const padding = getCameraPadding(true /* panel is open for a point selection */);
    const target = computeDetailCameraTarget(
      detailPixelData,
      padding,
      window.innerWidth,
      window.innerHeight,
    );
    if (!target) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    writeMapCameraState(map, padding, "fitToDetail");
    try {
      map.flyTo({
        center: [target.center.lng, target.center.lat],
        zoom: target.zoom,
        padding,
        duration: reducedMotion ? 0 : FLY_DURATION_MS,
        speed: 0.9,
        curve: 1.42,
        easing: (value) => 1 - ((1 - value) ** 3),
        essential: !reducedMotion,
      });
    } catch {
      // Stale/torn-down map instance — skip silently.
    }
  }, [detailPixelData]);

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
        // An accidental tap on empty map (panning, double-tap zoom) must not
        // silently discard the active selection. Explicit dismissal affordances
        // remain: the close button (fireDetail.closeLabel) and the
        // "Voltar ao mapa global" / "Back to global map" control in
        // FireDetailsPanel both call onClose → onSelect(null), reachable in
        // both mobile (sheet expanded) and desktop layouts.
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
      // Use getBackdropColor so the void/space colour is theme-aware rather
      // than hardcoded to one value.
      map.setPaintProperty("background", "background-color", getBackdropColor(theme));
    }
    syncSatelliteLayers(map, basemapMode);
    // Apply water layer overrides in both plain and satellite modes:
    //
    // Plain mode: Google-Maps-style blue replaces CARTO's near-white grey
    //   (positron) or muted blue-grey (dark-matter). Visibility is restored to
    //   "visible" here so a satellite→plain switch unhides any layer that was
    //   hidden in satellite mode.
    //
    // Satellite mode: hide the CARTO water fill layers so the Esri
    //   World_Imagery basemap's bathymetric relief (continental shelf, canyons,
    //   abyssal plains) shows through. The OCEAN_BATHYMETRY_LAYER background
    //   remains as the below-tile fallback for missing tiles at very low zoom.
    //   Only setLayoutProperty/setPaintProperty on EXISTING layers — adding
    //   new vector layers at style-load time is unsafe (the source is not yet
    //   initialised and silently breaks the raster layer).
    {
      const style = map.getStyle();
      if (style?.layers) {
        for (const override of getWaterColorOverrides(style.layers, theme, basemapMode)) {
          try {
            if (override.action === "hide") {
              map.setLayoutProperty(override.id, "visibility", "none");
            } else {
              // Restore visibility before repainting in case a previous satellite
              // session left this layer hidden.
              map.setLayoutProperty(override.id, "visibility", "visible");
              map.setPaintProperty(override.id, "fill-color", override.color);
            }
          } catch {
            // The layer may not exist in every style variant; skip silently.
          }
        }
      }
    }
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

      {/* Physical-geography labels (serras, peaks, volcanoes). Placed before the
          fire markers so critical fire information always draws on top, yet
          above the CARTO base symbols so MapLibre's collision engine makes them
          yield to city/road labels automatically. One symbol layer per zoom
          tier reproduces per-feature minZoom gating (filters cannot read
          ["zoom"]). Names are proper nouns from Natural Earth (public domain) +
          a curated volcano seed; the category words live in the i18n panel. */}
      <Source id={GEOGRAPHY_SOURCE_ID} type="geojson" data={GEOGRAPHY_LABELS}>
        {GEOGRAPHY_TIERS.map((tier) => (
          <Layer
            key={tier}
            id={`${GEOGRAPHY_LAYER_PREFIX}${tier}`}
            type="symbol"
            minzoom={tier}
            filter={["==", ["get", "minZoom"], tier]}
            layout={{
              "text-field": ["get", "name"],
              // Font stack with a fallback so labels still render if a basemap
              // style (e.g. positron in plain light mode) lacks the Semibold face.
              "text-font": ["Open Sans Semibold", "Open Sans Regular"],
              "text-size": ["match", ["get", "kind"], "range", 13, "volcano", 12, 11],
              "text-letter-spacing": ["match", ["get", "kind"], "range", 0.16, 0.02],
              "text-transform": ["match", ["get", "kind"], "range", "uppercase", "none"],
              "text-max-width": 7,
              // Lower sort key places first and wins collision, so higher
              // priority features survive when labels compete for space.
              "symbol-sort-key": ["-", 0, ["get", "priority"]],
            }}
            paint={{
              // Cool, restrained terrain palette so labels never read as active
              // fire; volcanoes get a slightly warmer stone tone to distinguish
              // them without implying they are burning.
              "text-color": ["match", ["get", "kind"], "volcano", "#f0c9a8", "range", "#dbe4ee", "#cdd7e3"],
              "text-opacity": 0.85,
              "text-halo-color": "rgba(8,12,22,0.85)",
              "text-halo-width": 1.2,
              "text-halo-blur": 0.4,
            }}
          />
        ))}
      </Source>

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
        {/* Glow: a very soft halo behind the cluster bubble. Dramatically
            smaller than before so it doesn't dominate the screen — the
            opacity and blur do the visual heavy lifting, not the radius.
            Uses sqrt compression so extreme FRP clusters are only modestly
            larger than moderate ones rather than expanding ~3× linearly. */}
        <Layer
          id={CLUSTER_GLOW_LAYER_ID}
          type="circle"
          maxzoom={VIIRS_MOSAIC_MIN_ZOOM}
          filter={["has", "point_count"]}
          paint={{
            "circle-radius": [
              "interpolate", ["linear"],
              // sqrt of sumTemporalFrpMw gives a perceptually sane compression:
              // sqrt(10000) = 100, sqrt(500) ≈ 22 — so the range collapses from
              // 0→10000 MW into roughly 0→100 on the interpolation axis.
              ["sqrt", ["get", "sumTemporalFrpMw"]],
              0, 9,
              10, 12,
              22, 16,
              50, 20,
              100, 24,
            ],
            "circle-color": "#ef4444",
            "circle-opacity": 0.14,
            "circle-blur": 0.65,
          }}
        />
        {/* Hit area: intentionally larger than the visible bubble so touch
            targets stay comfortable even though the rendered dot shrank.
            Do NOT shrink this layer — it is what handleClick intercepts. */}
        <Layer
          id={CLUSTER_HIT_AREA_LAYER_ID}
          type="circle"
          maxzoom={VIIRS_MOSAIC_MIN_ZOOM}
          filter={["has", "point_count"]}
          paint={{
            "circle-radius": [
              "interpolate", ["linear"],
              ["sqrt", ["get", "sumTemporalFrpMw"]],
              0, 16,
              10, 20,
              22, 24,
              50, 28,
              100, 32,
            ],
            "circle-opacity": 0,
            "circle-stroke-opacity": 0,
          }}
        />
        {/* Main cluster bubble. Half the former top-end radius (44→22 px) so
            a handful of 10 000 MW super-clusters stop dominating the whole
            viewport. Stroke is thinner and semi-transparent so it reads as
            a subtle edge, not a hard white bullseye. */}
        <Layer
          id={CLUSTER_LAYER_ID}
          type="circle"
          maxzoom={VIIRS_MOSAIC_MIN_ZOOM}
          filter={["has", "point_count"]}
          paint={{
            "circle-radius": [
              "interpolate", ["linear"],
              ["sqrt", ["get", "sumTemporalFrpMw"]],
              0, 7,
              10, 10,
              22, 13,
              50, 17,
              100, 22,
            ],
            "circle-color": [
              "interpolate", ["linear"], ["get", "sumTemporalFrpMw"],
              0, "#f5c451",
              250, "#f59e0b",
              1000, "#ef4444",
              5000, "#b91c1c",
            ],
            "circle-opacity": 0.92,
            // Thin, semi-transparent ring — reads as a soft edge, not a
            // hard bullseye that competes with the underlying marker.
            "circle-stroke-color": "rgba(255,255,255,0.55)",
            "circle-stroke-width": 1,
          }}
        />
        {/* Count label: hide on the smallest clusters (≤3 detections) so
            tiny dots stop shouting. Text size is kept modest to match the
            smaller bubbles. */}
        <Layer
          id={CLUSTER_COUNT_LAYER_ID}
          type="symbol"
          maxzoom={VIIRS_MOSAIC_MIN_ZOOM}
          filter={["all", ["has", "point_count"], [">=", ["get", "point_count"], 4]]}
          layout={{
            "text-field": ["get", "point_count_abbreviated"],
            "text-size": 11,
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
          maxzoom={VIIRS_MOSAIC_MIN_ZOOM}
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

      {/* Thermal-density field — the primary close-zoom representation, taking
          over from the circular markers at exactly VIIRS_MOSAIC_MIN_ZOOM. This
          is a native GPU heatmap fed by RAW detection points (density.ts),
          never grid-snapped squares, so there are zero seams by construction.
          What it represents: thermal-detection density weighted by FRP,
          recency, and confidence — an estimated activity field, NOT a measured
          fire perimeter. The panel states this provenance explicitly. */}
      <Source id={DENSITY_SOURCE_ID} type="geojson" data={densityData}>
        <Layer
          id={DENSITY_HEATMAP_LAYER_ID}
          type="heatmap"
          minzoom={DENSITY_MIN_ZOOM}
          paint={{
            // Per-point weight (0..1) from the FRP × recency × confidence model.
            "heatmap-weight": ["coalesce", ["get", "weight"], 0.1],
            // As the radius grows with zoom the same weight is spread over more
            // pixels, so density falls; lift intensity as you zoom in to hold a
            // legible field. Higher at the wide end (a spread fire framed at
            // ~z10 has its points thinned on screen and needs the boost).
            // Calibrated by eye in-browser.
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 8, 2.2, VIIRS_MOSAIC_MIN_ZOOM, 1.8, 13, 2.8, 16, 5],
            // Radius is in SCREEN pixels, so a fixed value would decouple the
            // blob from the ground as you zoom. This ramp keeps a roughly
            // ground-locked kernel of a few VIIRS pixels — large enough to erase
            // the grid and merge neighbouring detections into a continuous
            // activity zone, small enough that it reads as an inferred density
            // field, never a measured perimeter (which the panel states). At
            // zoom 11 a 375 m pixel is ~6 px, so ~24 px ≈ 4 sensor pixels.
            "heatmap-radius": ["interpolate", ["exponential", 1.8], ["zoom"], 9, 16, VIIRS_MOSAIC_MIN_ZOOM, 24, 13, 48, 16, 220],
            // Amber (outer, diffuse) → orange → red (saturated core). Alpha
            // ramps from fully transparent at the low-density fringe so the
            // boundary feathers out and the satellite imagery stays readable.
            "heatmap-color": [
              "interpolate", ["linear"], ["heatmap-density"],
              0.0, "rgba(0,0,0,0)",
              0.08, "rgba(254,240,138,0.30)", // pale amber — soft diffuse edge
              0.25, "rgba(251,191,36,0.62)",  // amber — outer activity zone
              0.45, "rgba(249,115,22,0.78)",  // orange — active region
              0.65, "rgba(234,88,12,0.88)",   // deep orange — strong activity
              0.85, "rgba(220,38,38,0.93)",   // red — intense
              1.0, "rgba(153,27,27,0.96)",    // deep red — most intense core
            ],
            // Top out below 1 so imagery is never fully buried; ease down at the
            // closest zoom where the footprint outlines take over the detail.
            "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.88, VIIRS_MOSAIC_MIN_ZOOM, 0.85, 14, 0.72, 16, 0.55],
          }}
        />
      </Source>

      {/* Individual 375 m sensor footprints as a thin outline, revealed only at
          very close zoom beneath the density field. This is honest
          instrumentation — the real VIIRS footprint — not painted fire, and it
          is drawn only from full-resolution detail so it is bounded. */}
      <Source id={FOOTPRINT_SOURCE_ID} type="geojson" data={footprintData}>
        <Layer
          id={FOOTPRINT_OUTLINE_LAYER_ID}
          type="line"
          minzoom={FOOTPRINT_MIN_ZOOM}
          paint={{
            "line-color": "rgba(255,255,255,0.45)",
            "line-width": 0.6,
          }}
        />
      </Source>
      </Map>
    </div>
  );
}
