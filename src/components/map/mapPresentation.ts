export type MapTheme = "dark" | "light";
export type BasemapMode = "satellite" | "plain";

export const VECTOR_STYLE_URL = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;

export const SATELLITE_STYLE_URL = VECTOR_STYLE_URL.dark;
export const DARK_BACKGROUND = "#0f172a";
export const SATELLITE_BACKGROUND = "#051937";

const MOBILE_GLOBAL_PANEL_HEIGHT_RATIO = 0.6;
const MOBILE_MAP_GAP = 24;

export interface CameraPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CameraPaddingOptions {
  viewportWidth: number;
  viewportHeight: number;
  panelOpen: boolean;
}

export interface StyleLayerLike {
  id: string;
  type: string;
  source?: unknown;
  "source-layer"?: string;
  filter?: unknown;
}

export interface SatelliteLayerPlan {
  overlayBeforeLayerId?: string;
}

interface StyleReadyObservable {
  isStyleLoaded(): boolean | void;
  on(event: "style.load", listener: () => void): void;
  off(event: "style.load", listener: () => void): void;
}

export function getMapStyleUrl(theme: MapTheme, basemapMode: BasemapMode): string {
  return basemapMode === "satellite" ? SATELLITE_STYLE_URL : VECTOR_STYLE_URL[theme];
}

export function observeStyleReady(
  map: StyleReadyObservable,
  synchronize: () => void,
): () => void {
  const synchronizeOnStyleLoad = () => synchronize();

  map.on("style.load", synchronizeOnStyleLoad);
  if (map.isStyleLoaded() === true) synchronize();
  return () => map.off("style.load", synchronizeOnStyleLoad);
}

export function getCameraPadding({
  viewportWidth,
  viewportHeight,
  panelOpen,
}: CameraPaddingOptions): CameraPadding {
  const isDesktop = viewportWidth >= 768;
  return {
    top: 88,
    right: isDesktop ? 440 : 24,
    bottom: isDesktop
      ? 56
      : panelOpen
        ? Math.min(
            Math.round(viewportHeight * MOBILE_GLOBAL_PANEL_HEIGHT_RATIO) + MOBILE_MAP_GAP,
            Math.max(120, viewportHeight - 120),
          )
        : 88,
    left: isDesktop ? 40 : 24,
  };
}

export function getSatelliteLayerPlan(layers: readonly StyleLayerLike[]): SatelliteLayerPlan {
  // Preserve provider labels and administrative boundaries above imagery.
  // The bathymetry layer is positioned relative to the raster itself.
  const overlayBeforeLayerId = layers.find((layer) => (
    layer.id !== "satellite-layer"
    && layer.id !== "ocean-bathymetry"
    && (layer.type === "symbol" || (layer.type === "line" && /boundary|admin/i.test(layer.id)))
  ))?.id;

  return { overlayBeforeLayerId };
}
