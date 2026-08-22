/** Kind of physical-geography feature this module knows how to surface. */
export type PhysicalFeatureKind = "range" | "peak" | "volcano";

/**
 * A single physical-geography feature (mountain range, named peak, or
 * volcano) normalized for map labeling and nearest-feature lookups.
 */
export interface PhysicalFeature {
  id: string;
  kind: PhysicalFeatureKind;
  name: string;
  lat: number;
  lng: number;
  /** MapLibre zoom level at which this feature's label should first appear. */
  minZoom: number;
  /** Symbol-sort-key input; higher means more important / drawn on top. */
  priority: number;
  country?: string;
  region?: string;
  /** Volcano type (e.g. "stratovolcano") or other feature-specific type tag. */
  type?: string;
  elevationM?: number;
}

/** Properties carried by each point in the geography label GeoJSON layer. */
export interface GeographyLabelProperties {
  name: string;
  kind: PhysicalFeatureKind;
  minZoom: number;
  priority: number;
}

export type GeographyLabelFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  GeographyLabelProperties
>;
