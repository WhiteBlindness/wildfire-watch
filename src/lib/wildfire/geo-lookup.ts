import "server-only";

// FIRMS hotspots carry no place name, only coordinates. This is a best-effort
// bounding-box lookup for display purposes only — not a geocoding service —
// so real-data events can still show a readable country/region instead of
// raw coordinates. Falls back to a rough continent guess, never invents a
// precise place name it doesn't have evidence for.

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

function continentGuess(lat: number, lng: number): { country: string; region: string } {
  if (lat > 35 && lng > -15 && lng < 45) return { country: "Europa", region: "Região não identificada" };
  if (lng < -30 && lat > 5) return { country: "América do Norte", region: "Região não identificada" };
  if (lng < -30 && lat <= 5) return { country: "América do Sul", region: "Região não identificada" };
  if (lng >= -20 && lng < 55 && lat <= 35) return { country: "África", region: "Região não identificada" };
  if (lng >= 55 && lat > -10) return { country: "Ásia", region: "Região não identificada" };
  if (lng >= 95 && lat <= -10) return { country: "Oceania", region: "Região não identificada" };
  return { country: "Localização remota", region: "Região não identificada" };
}

/** Best-effort country/region label from a coordinate, for display only. */
export function lookupPlace(lat: number, lng: number): { country: string; region: string } {
  const hit = COUNTRY_BOXES.find(
    (box) => lng >= box.west && lng <= box.east && lat >= box.south && lat <= box.north,
  );
  if (hit) return { country: hit.country, region: hit.region };
  return continentGuess(lat, lng);
}
