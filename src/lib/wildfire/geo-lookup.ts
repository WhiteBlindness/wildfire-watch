import { bbox } from "@turf/turf";
import { geoContains } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import worldAtlas from "world-atlas/countries-110m.json";

type CountryGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;
type CountryProperties = { name?: string };

interface CountryBoundary {
  country: string;
  feature: GeoJSON.Feature<CountryGeometry, CountryProperties>;
  bounds: GeoJSON.BBox;
}

const topology = worldAtlas as unknown as Topology<{ countries: GeometryCollection<CountryProperties> }>;
const countryCollection = feature(topology, topology.objects.countries) as GeoJSON.FeatureCollection<
  CountryGeometry,
  CountryProperties
>;
const COUNTRY_BOUNDARIES: CountryBoundary[] = countryCollection.features
  .filter((countryFeature) => Boolean(countryFeature.properties?.name))
  .map((countryFeature) => ({
    country: countryFeature.properties?.name ?? "Unknown",
    feature: countryFeature,
    bounds: bbox(countryFeature),
  }));

/**
 * Infers the country containing a coordinate from Natural Earth boundaries
 * (110 m scale). Returns null at sea or outside every boundary. This is a
 * WildfireWatch inference, not a value reported by the data source.
 */
export function lookupCountry(lat: number, lng: number): string | null {
  const hit = COUNTRY_BOUNDARIES.find(({ bounds, feature: countryFeature }) => (
    lng >= bounds[0]
    && lat >= bounds[1]
    && lng <= bounds[2]
    && lat <= bounds[3]
    && geoContains(countryFeature, [lng, lat])
  ));
  return hit?.country ?? null;
}
