// FIRMS hotspots carry coordinates rather than administrative names. This is
// a best-effort display lookup, not a geocoding service.
interface CountryBox {
  country: string;
  region: string;
  west: number;
  south: number;
  east: number;
  north: number;
}

const COUNTRY_BOXES: CountryBox[] = [
  { country: "Portugal", region: "Continente", west: -9.6, south: 36.8, east: -6.1, north: 42.2 },
  { country: "Espanha", region: "Península Ibérica", west: -9.5, south: 35.9, east: 3.4, north: 43.9 },
  { country: "França", region: "Metrópole", west: -5.2, south: 41.3, east: 9.7, north: 51.1 },
  { country: "Itália", region: "Península Itálica", west: 6.6, south: 35.4, east: 18.6, north: 47.1 },
  { country: "Grécia", region: "Continente e ilhas", west: 19.3, south: 34.7, east: 29.7, north: 41.8 },
  { country: "Turquia", region: "Anatólia", west: 25.6, south: 35.8, east: 44.8, north: 42.1 },
  { country: "Estados Unidos", region: "Costa Oeste", west: -125, south: 32, east: -114, north: 49 },
  { country: "Canadá", region: "Território federal", west: -141, south: 41.6, east: -52.6, north: 70 },
  { country: "Brasil", region: "Amazónia", west: -74, south: -18, east: -44, north: 5.3 },
  { country: "Austrália", region: "Território federal", west: 112.9, south: -43.6, east: 153.6, north: -10 },
  { country: "África do Sul", region: "Território nacional", west: 16.4, south: -34.8, east: 32.9, north: -22.1 },
  { country: "Indonésia", region: "Arquipélago", west: 95, south: -11, east: 141, north: 6 },
];

/** Best-effort country/region label from a coordinate, for display only. */
export function lookupPlace(lat: number, lng: number): { country: string; region: string } {
  const hit = COUNTRY_BOXES.find(
    (box) => lng >= box.west && lng <= box.east && lat >= box.south && lat <= box.north,
  );
  if (hit) return { country: hit.country, region: hit.region };

  // A continent is too broad to be useful once every anomaly is an individual
  // point. The detail panel supplies precise coordinates as the fallback.
  return { country: "Localização aproximada", region: "Sem correspondência territorial" };
}
