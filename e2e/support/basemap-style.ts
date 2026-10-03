/**
 * A small stand-in for the CARTO vector styles: the same layer names and
 * kinds the app adjusts (background, water fill, boundary line, label symbol)
 * over a GeoJSON source, so rendering can be checked without CARTO's tiles.
 *
 * Water starts magenta on purpose: the app must recolour it in plain mode and
 * hide it in satellite mode, so any magenta on screen means it did neither.
 */
export const STYLE_WATER_COLOUR = [255, 0, 255] as const;

const box = (west: number, south: number, east: number, north: number) => [[
  [west, south], [east, south], [east, north], [west, north], [west, south],
]];

export const BASEMAP_STYLE = {
  version: 8,
  name: "e2e-basemap",
  glyphs: "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf",
  sources: {
    carto: {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          // The eastern North Atlantic, west of Iberia, inside the initial view.
          { type: "Feature", properties: { kind: "water" }, geometry: { type: "Polygon", coordinates: box(-34, 30, -14, 47) } },
          { type: "Feature", properties: { kind: "border" }, geometry: { type: "LineString", coordinates: [[-7, 37], [-7, 42]] } },
          { type: "Feature", properties: { kind: "label", name: "Portugal" }, geometry: { type: "Point", coordinates: [-8, 39.5] } },
        ],
      },
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#0f172a" } },
    {
      id: "water",
      type: "fill",
      source: "carto",
      filter: ["==", ["get", "kind"], "water"],
      paint: { "fill-color": `rgb(${STYLE_WATER_COLOUR.join(",")})` },
    },
    {
      id: "boundary_country",
      type: "line",
      source: "carto",
      filter: ["==", ["get", "kind"], "border"],
      paint: { "line-color": "#8a8f98", "line-width": 1 },
    },
    {
      id: "place_country",
      type: "symbol",
      source: "carto",
      filter: ["==", ["get", "kind"], "label"],
      layout: { "text-field": ["get", "name"], "text-font": ["Open Sans Regular"], "text-size": 12 },
    },
  ],
};
