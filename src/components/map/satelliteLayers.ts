import type { AddLayerObject, RasterSourceSpecification } from "maplibre-gl";
import type { BasemapMode, StyleLayerLike } from "./mapPresentation";
import { SATELLITE_BACKGROUND, getSatelliteLayerPlan } from "./mapPresentation";

export const SATELLITE_SOURCE_ID = "satellite-src";
export const SATELLITE_LAYER_ID = "satellite-layer";
export const OCEAN_BATHYMETRY_LAYER_ID = "ocean-bathymetry";

const LEGACY_SATELLITE_LAYER_IDS = ["satellite-ocean-mask", "satellite-background"] as const;
const SATELLITE_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_ATTRIBUTION = "© Esri, Maxar, Earthstar Geographics, and the GIS User Community";

export const OCEAN_BATHYMETRY_LAYER: AddLayerObject = {
  id: OCEAN_BATHYMETRY_LAYER_ID,
  type: "background",
  paint: { "background-color": SATELLITE_BACKGROUND },
};

const SATELLITE_RASTER_SOURCE: RasterSourceSpecification = {
  type: "raster",
  tiles: [SATELLITE_TILE_URL],
  tileSize: 256,
  attribution: SATELLITE_ATTRIBUTION,
};

// Raster paint calibration rationale:
//
//   raster-saturation: 0.08  — a subtle natural lift that keeps land colours
//     (Saharan sand, Arctic ice, European forest) looking like real satellite
//     imagery rather than a processed filter. The ocean is also served here:
//     in satellite mode getWaterColorOverrides hides the CARTO "water" fill so
//     the Esri World_Imagery ocean tiles are fully visible with their built-in
//     bathymetric depth colour (continental shelf, canyons, abyssal plains).
//     0.08 matched a verified Google-Earth screenshot; 0.45 caused the Sahara
//     to render as neon yellow (the "radioactive" failure mode).
//
//   raster-brightness-min: 0  — no artificial floor. Land is already well
//     above 0 luminance, and the Esri ocean depth colours are preserved by the
//     imagery tiles themselves (no need to boost from near-black). Keeping at
//     default avoids clipping ocean depth gradients.
//
//   raster-contrast: 0.05  — very slight sharpening for a Google-Earth-like
//     punch; kept small to avoid clipping highlights.
const SATELLITE_RASTER_LAYER: AddLayerObject = {
  id: SATELLITE_LAYER_ID,
  type: "raster",
  source: SATELLITE_SOURCE_ID,
  paint: {
    "raster-brightness-max": 1,
    "raster-brightness-min": 0,
    "raster-saturation": 0.08,
    "raster-contrast": 0.05,
    "raster-opacity": 1,
  },
};

export interface SatelliteLayerMap {
  getStyle(): { layers?: readonly StyleLayerLike[] };
  getLayer(id: string): unknown;
  addLayer(layer: AddLayerObject, beforeId?: string): unknown;
  moveLayer(id: string, beforeId?: string): unknown;
  removeLayer(id: string): unknown;
  getSource(id: string): unknown;
  addSource(id: string, source: RasterSourceSpecification): unknown;
  removeSource(id: string): unknown;
}

function moveLayerImmediatelyBefore(map: SatelliteLayerMap, layerId: string, beforeId: string): void {
  if (!map.getLayer(layerId) || !map.getLayer(beforeId)) return;
  const layers = map.getStyle().layers ?? [];
  const currentIndex = layers.findIndex((layer) => layer.id === layerId);
  const beforeIndex = layers.findIndex((layer) => layer.id === beforeId);
  if (currentIndex !== -1 && beforeIndex !== -1 && currentIndex !== beforeIndex - 1) {
    map.moveLayer(layerId, beforeId);
  }
}

function removeSatelliteLayers(map: SatelliteLayerMap): void {
  if (map.getLayer(OCEAN_BATHYMETRY_LAYER_ID)) map.removeLayer(OCEAN_BATHYMETRY_LAYER_ID);
  if (map.getLayer(SATELLITE_LAYER_ID)) map.removeLayer(SATELLITE_LAYER_ID);
  for (const legacyLayerId of LEGACY_SATELLITE_LAYER_IDS) {
    if (map.getLayer(legacyLayerId)) map.removeLayer(legacyLayerId);
  }
  if (map.getSource(SATELLITE_SOURCE_ID)) map.removeSource(SATELLITE_SOURCE_ID);
}

export function syncSatelliteLayers(map: SatelliteLayerMap, mode: BasemapMode): void {
  if (mode === "plain") {
    removeSatelliteLayers(map);
    return;
  }

  for (const legacyLayerId of LEGACY_SATELLITE_LAYER_IDS) {
    if (map.getLayer(legacyLayerId)) map.removeLayer(legacyLayerId);
  }

  if (!map.getSource(SATELLITE_SOURCE_ID)) {
    map.addSource(SATELLITE_SOURCE_ID, SATELLITE_RASTER_SOURCE);
  }

  const { overlayBeforeLayerId } = getSatelliteLayerPlan(map.getStyle().layers ?? []);
  if (!map.getLayer(SATELLITE_LAYER_ID)) {
    map.addLayer(SATELLITE_RASTER_LAYER, overlayBeforeLayerId);
  } else if (overlayBeforeLayerId) {
    moveLayerImmediatelyBefore(map, SATELLITE_LAYER_ID, overlayBeforeLayerId);
  }

  if (!map.getLayer(OCEAN_BATHYMETRY_LAYER_ID)) {
    map.addLayer(OCEAN_BATHYMETRY_LAYER, SATELLITE_LAYER_ID);
  } else {
    moveLayerImmediatelyBefore(map, OCEAN_BATHYMETRY_LAYER_ID, SATELLITE_LAYER_ID);
  }
}
