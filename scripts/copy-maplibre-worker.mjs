// MapLibre 6 runs its tile parsing in a module worker that imports a sibling
// chunk by relative path. Next.js (Turbopack and webpack) does not emit that
// sibling, so both files are copied from the installed package into public/
// before every build and dev server start, and the map points setWorkerUrl()
// at them. Serving them from this origin also keeps the CSP at
// `worker-src 'self'`, with no blob: workers.
// See https://maplibre.org/maplibre-gl-js/docs/#esm (Turbopack).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const dist = path.join(path.dirname(require.resolve("maplibre-gl/package.json")), "dist");
const destination = path.join(process.cwd(), "public", "maplibre");

mkdirSync(destination, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(path.join(dist, file), path.join(destination, file));
}
