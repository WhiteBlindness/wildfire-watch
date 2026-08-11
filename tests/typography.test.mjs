import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const readProjectFile = (path) => readFileSync(join(projectRoot, path), "utf8");

const layout = readProjectFile("src/app/layout.tsx");
const globals = readProjectFile("src/app/globals.css");
const overview = readProjectFile("src/components/panel/GlobalOverview.tsx");
const fireDetails = readProjectFile("src/components/panel/FireDetailsPanel.tsx");
const telemetry = readProjectFile("src/components/panel/FireTelemetryDashboard.tsx");
const timeline = readProjectFile("src/components/map/GlobalTimelineControl.tsx");
const legend = readProjectFile("src/components/map/Legend.tsx");
const design = readProjectFile("DESIGN.md");

test("loads JetBrains Mono as the root data face without regressing hydration handling", () => {
  assert.match(layout, /import \{ Geist, JetBrains_Mono \} from "next\/font\/google";/);
  assert.match(
    layout,
    /const jetbrainsMono = JetBrains_Mono\(\{\s*variable: "--font-mono",\s*subsets: \["latin"\],\s*\}\);/s,
  );
  assert.match(layout, /suppressHydrationWarning/);
  assert.match(layout, /\$\{geistSans\.variable\} \$\{jetbrainsMono\.variable\}/);
  assert.doesNotMatch(layout, /Geist_Mono|geistMono/);
});

test("lets the injected Tailwind v4 mono token flow directly into map controls", () => {
  assert.doesNotMatch(globals, /--font-mono\s*:\s*var\(--font-mono\)/);
  assert.doesNotMatch(globals, /--font-geist-mono/);
  assert.match(
    globals,
    /\.wildfire-watch \.maplibregl-ctrl-scale[\s\S]*?font-family:\s*var\(--font-mono\),\s*ui-monospace/,
  );
  assert.match(
    globals,
    /\.wildfire-watch \.maplibregl-ctrl-scale[\s\S]*?font-variant-numeric:\s*tabular-nums/,
  );
});

test("documents JetBrains Mono as the authoritative operational data face", () => {
  assert.match(design, /\*\*Mono Font:\*\* JetBrains Mono/);
  assert.match(design, /data|telemetry|coordinates|measurements/i);
  assert.doesNotMatch(design, /\*\*Mono Font:\*\* Geist Mono/);
});

test("uses monospaced tabular numerals for overview and fire-detail readouts", () => {
  assert.match(overview, /mt-1 font-mono text-2xl font-semibold tabular-nums/);
  assert.match(overview, /aria-live="polite"[\s\S]*?font-mono[\s\S]*?tabular-nums/);
  assert.match(overview, /\{badge && <span className="[^"]*font-mono[^"]*tabular-nums[^"]*"/);
  assert.match(fireDetails, /<dd className="[^"]*font-mono[^"]*tabular-nums[^"]*"/);
  assert.match(fireDetails, /formatUtcDateTime[\s\S]*?font-mono[^"]*tabular-nums/);
});

test("uses the data face for weather, air-quality, news-time, and timeline telemetry", () => {
  assert.match(telemetry, /liveLabel[\s\S]*?font-mono[^"]*tabular-nums/);
  assert.match(telemetry, /tone\.label[\s\S]*?font-mono[^"]*tabular-nums/);
  assert.match(telemetry, /reading\.distanceKm[\s\S]*?font-mono[^"]*tabular-nums/);
  assert.match(telemetry, /dateTime=\{article\.publishedAt\}[\s\S]*?font-mono[^"]*tabular-nums/);
  assert.match(telemetry, /function WeatherStat[\s\S]*?<dd className="[^"]*font-mono[^"]*tabular-nums/);
  assert.match(timeline, /<output className="[^"]*font-mono[^"]*tabular-nums/);
  assert.match(timeline, /aria-hidden="true" className="[^"]*font-mono[^"]*tabular-nums/);
  assert.match(timeline, /<span className="font-mono tabular-nums">\{currentLabel\}<\/span>/);
  assert.match(legend, /<li key=\{severity\} className="[^"]*font-mono[^"]*"/);
});
