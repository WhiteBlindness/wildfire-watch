import mountainRangesData from "./data/mountain-ranges.json";
import peaksData from "./data/peaks.json";
import volcanoesData from "./data/volcanoes.json";
import type { PhysicalFeature } from "./types";

interface RawRange {
  id: string;
  name: string;
  lat: number;
  lng: number;
  scalerank: number;
}

interface RawPeak {
  id: string;
  name: string;
  lat: number;
  lng: number;
  scalerank: number;
  elevationM?: number;
}

interface RawVolcano {
  id: string;
  name: string;
  lat: number;
  lng: number;
  country: string;
  region: string;
  type: string;
}

// ---------------------------------------------------------------------------
// Zoom tiering
//
// Natural Earth's SCALERANK/scalerank fields rank features by cartographic
// importance: rank 1 is drawn at the smallest (world) zoom levels, higher
// ranks only appear as the map zooms in. We translate that ordinal rank into
// a MapLibre `minZoom` so far-out views show only the handful of major
// features and zooming in progressively reveals the rest.
//
// Mountain ranges (ne_10m_geography_regions_polys.geojson, FEATURECLA ===
// "Range/mtn") carry SCALERANK 1-6 and are the earliest tier to appear:
//   scalerank -> minZoom
//   1 -> 0   2 -> 1   3 -> 2   4 -> 3   5 -> 4   6 -> 5
//
// Named peaks (ne_10m_geography_regions_elevation_points.geojson,
// featurecla === "mountain") carry scalerank 1-7 and 9 (rank 8 does not occur
// in the source data) and are deliberately shifted later so they only reveal
// once a range-level view is already zoomed past:
//   scalerank -> minZoom
//   1 -> 3   2 -> 4   3 -> 5   4 -> 6   5 -> 7   6 -> 8   7 -> 9   8 -> 10   9 -> 11
// ---------------------------------------------------------------------------

const RANGE_MIN_ZOOM_BY_SCALERANK: Record<number, number> = {
  1: 0,
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
};
const RANGE_FALLBACK_MIN_ZOOM = 5;

const PEAK_MIN_ZOOM_BY_SCALERANK: Record<number, number> = {
  1: 3,
  2: 4,
  3: 5,
  4: 6,
  5: 7,
  6: 8,
  7: 9,
  8: 10,
  9: 11,
};
const PEAK_FALLBACK_MIN_ZOOM = 9;

// Volcanoes have no cartographic scalerank in the curated seed data, so
// importance is approximated with a small hand-picked set of globally
// iconic volcanoes (frequently erupting, historically significant, or
// widely recognized) that should label in from a continental-scale view.
// Everything else labels in once the user has zoomed to a regional view.
const MAJOR_VOLCANO_IDS = new Set([
  "etna",
  "vesuvius",
  "stromboli",
  "fuji",
  "krakatau",
  "pinatubo",
  "st-helens",
  "kilauea",
  "mauna-loa",
  "teide",
  "hekla",
  "eyjafjallajokull",
  "popocatepetl",
  "cotopaxi",
  "kilimanjaro",
  "ararat",
  "damavand",
  "tambora",
  "toba",
  "agung",
  "merapi",
  "rainier",
  "yellowstone",
  "nyiragongo",
  "erebus",
  "sakurajima",
  "taal",
  "mayon",
  "villarrica",
  "klyuchevskaya",
  "cumbre-vieja",
  "fagradalsfjall",
]);
const MAJOR_VOLCANO_MIN_ZOOM = 2;
const MINOR_VOLCANO_MIN_ZOOM = 5;
const MAJOR_VOLCANO_PRIORITY = 10;
const MINOR_VOLCANO_PRIORITY = 5;

function buildFeatures(): PhysicalFeature[] {
  const ranges = (mountainRangesData as RawRange[]).map((range): PhysicalFeature => ({
    id: `range-${range.id}`,
    kind: "range",
    name: range.name,
    lat: range.lat,
    lng: range.lng,
    minZoom: RANGE_MIN_ZOOM_BY_SCALERANK[range.scalerank] ?? RANGE_FALLBACK_MIN_ZOOM,
    // Lower scalerank = more important, so priority is inverted (7 - rank).
    priority: 7 - range.scalerank,
  }));

  const peaks = (peaksData as RawPeak[]).map((peak): PhysicalFeature => ({
    id: `peak-${peak.id}`,
    kind: "peak",
    name: peak.name,
    lat: peak.lat,
    lng: peak.lng,
    minZoom: PEAK_MIN_ZOOM_BY_SCALERANK[peak.scalerank] ?? PEAK_FALLBACK_MIN_ZOOM,
    priority: peak.elevationM ? Math.round(peak.elevationM / 1000) : 10 - peak.scalerank,
    elevationM: peak.elevationM,
  }));

  const volcanoesSeed = volcanoesData as { version: number; provenance: string; volcanoes: RawVolcano[] };
  const volcanoes = volcanoesSeed.volcanoes.map((volcano): PhysicalFeature => {
    const isMajor = MAJOR_VOLCANO_IDS.has(volcano.id);
    return {
      id: `volcano-${volcano.id}`,
      kind: "volcano",
      name: volcano.name,
      lat: volcano.lat,
      lng: volcano.lng,
      minZoom: isMajor ? MAJOR_VOLCANO_MIN_ZOOM : MINOR_VOLCANO_MIN_ZOOM,
      priority: isMajor ? MAJOR_VOLCANO_PRIORITY : MINOR_VOLCANO_PRIORITY,
      country: volcano.country,
      region: volcano.region,
      type: volcano.type,
    };
  });

  return [...ranges, ...peaks, ...volcanoes];
}

let cachedFeatures: PhysicalFeature[] | null = null;

/** All physical-geography features (ranges, peaks, volcanoes), memoized. */
export function getPhysicalFeatures(): PhysicalFeature[] {
  if (!cachedFeatures) {
    cachedFeatures = buildFeatures();
  }
  return cachedFeatures;
}
