/**
 * HTTP security headers, built from what the app actually loads.
 *
 * Browser-side third parties, and why each is allowed to be fetched:
 *   - basemaps.cartocdn.com, *.basemaps.cartocdn.com: CARTO vector style, tiles, glyphs, sprites;
 *   - server.arcgisonline.com: Esri World Imagery raster tiles;
 *   - api.open-meteo.com: model weather for the selected detection (see src/lib/weather/open-meteo.ts).
 * Every other request goes to this origin. MapLibre loads tiles with fetch()
 * and decodes them in blob: workers, hence connect-src and worker-src blob:.
 *
 * 'unsafe-inline' remains in script-src because Next.js inlines its bootstrap
 * and RSC payload scripts in statically rendered pages, which cannot carry a
 * per-request nonce. No third-party script is loaded, so the residual risk is
 * an injection into this app's own HTML. 'unsafe-eval' is only added in
 * development, where React Refresh needs it.
 *
 * next.config.ts applies these to responses from the Worker; public/_headers
 * applies the same values to static assets, which Cloudflare serves without
 * running the Worker. A test keeps the two in step.
 */

export const MAP_TILE_ORIGINS = [
  "https://basemaps.cartocdn.com",
  "https://*.basemaps.cartocdn.com",
  "https://server.arcgisonline.com",
] as const;

export const WEATHER_ORIGIN = "https://api.open-meteo.com";

export function contentSecurityPolicy({ development = false }: { development?: boolean } = {}): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(development ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...MAP_TILE_ORIGINS, WEATHER_ORIGIN],
    "worker-src": ["'self'", "blob:"],
    "child-src": ["blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

export function securityHeaders({ development = false }: { development?: boolean } = {}): Array<{ key: string; value: string }> {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy({ development }) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()",
    },
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ];
}
