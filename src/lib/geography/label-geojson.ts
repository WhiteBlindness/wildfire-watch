import { getPhysicalFeatures } from "./features";
import type { GeographyLabelFeatureCollection } from "./types";

/**
 * Builds a GeoJSON FeatureCollection of Points suitable for a MapLibre
 * symbol layer showing mountain range / peak / volcano labels, with
 * `minZoom` and `priority` properties for filter/sort expressions.
 */
export function buildGeographyLabelGeoJSON(): GeographyLabelFeatureCollection {
  return {
    type: "FeatureCollection",
    features: getPhysicalFeatures().map((feature) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [feature.lng, feature.lat],
      },
      properties: {
        name: feature.name,
        kind: feature.kind,
        minZoom: feature.minZoom,
        priority: feature.priority,
      },
    })),
  };
}
