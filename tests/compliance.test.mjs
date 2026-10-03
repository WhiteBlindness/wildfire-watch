import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const readProjectFile = (path) => readFileSync(join(projectRoot, path), "utf8");

function listFiles(directory, extensions) {
  const entries = readdirSync(join(projectRoot, directory));
  return entries.flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(join(projectRoot, path)).isDirectory()) return listFiles(path, extensions);
    return extensions.some((extension) => path.endsWith(extension)) ? [path] : [];
  });
}

const componentFiles = listFiles("src", [".tsx"]).filter((path) => !path.includes(".test."));
const sourceFiles = listFiles("src", [".ts", ".tsx"]).filter((path) => !path.includes(".test."));

// The create-next-app favicon is the Vercel triangle, a third-party trademark.
const NEXT_DEFAULT_FAVICON_MD5 = "c30c7d42707a47a3f4591831641e50dc";

test("publishes about, privacy and terms pages with their own titles", () => {
  for (const route of ["sobre", "privacidade", "termos"]) {
    const path = `src/app/${route}/page.tsx`;
    assert.ok(existsSync(join(projectRoot, path)), `expected ${path} to exist`);
    const page = readProjectFile(path);
    assert.match(page, /export const metadata/, `${path} must export page metadata`);
    assert.match(page, /title:/, `${path} must set a page title`);
  }
});

test("every panel view links to the legal pages and carries the emergency notice", () => {
  const footer = readProjectFile("src/components/panel/PanelFooter.tsx");
  for (const route of ["about", "privacy", "terms"]) {
    assert.match(footer, new RegExp(`href=\\{LEGAL_ROUTES\\.${route}\\}`), `footer must link to the ${route} page`);
  }
  const site = readProjectFile("src/lib/site.ts");
  for (const path of ["/sobre", "/privacidade", "/termos"]) {
    assert.match(site, new RegExp(`"${path}"`), `LEGAL_ROUTES must point to ${path}`);
  }
  assert.match(footer, /t\.legal\.emergencyNotice/);
  assert.match(readProjectFile("src/components/panel/GlobalOverview.tsx"), /<PanelFooter\b/);
  assert.match(readProjectFile("src/components/panel/FireDetailsPanel.tsx"), /<PanelFooter\b/);

  for (const dictionary of ["src/lib/i18n/pt.ts", "src/lib/i18n/en.ts"]) {
    assert.match(readProjectFile(dictionary), /emergencyNotice:[^\n]*112/, `${dictionary} must point to 112`);
  }
});

test("ships an original app icon instead of the create-next-app favicon", () => {
  const faviconPath = join(projectRoot, "src/app/favicon.ico");
  if (existsSync(faviconPath)) {
    const digest = createHash("md5").update(readFileSync(faviconPath)).digest("hex");
    assert.notEqual(digest, NEXT_DEFAULT_FAVICON_MD5, "the default Next.js favicon must not ship");
  }
  assert.ok(existsSync(join(projectRoot, "src/app/icon.svg")), "expected src/app/icon.svg");
});

test("keeps secondary text at or above WCAG AA contrast in both themes", () => {
  // Measured against the light and dark surfaces: foreground at 60 % opacity is
  // the lowest value that clears 4.5:1 on every panel surface in light mode.
  for (const path of componentFiles) {
    const source = readProjectFile(path);
    for (const match of source.matchAll(/text-foreground\/(\d+)/g)) {
      assert.ok(Number(match[1]) >= 60, `${path} uses low-contrast ${match[0]}`);
    }
    assert.doesNotMatch(source, /(?<!dark:)text-amber-500\b/, `${path} uses amber-500 text on light surfaces`);
    assert.doesNotMatch(source, /(?<!dark:)text-red-700\/\d+/, `${path} dims red-700 text below AA`);
  }
});

test("hides decorative inline SVG icons from assistive technology", () => {
  for (const path of componentFiles) {
    const source = readProjectFile(path);
    for (const match of source.matchAll(/<svg\b[^>]*>/g)) {
      assert.match(match[0], /aria-hidden/, `${path} has an inline <svg> without aria-hidden`);
    }
  }
});

test("draws a visible keyboard focus indicator for every focusable element", () => {
  const globals = readProjectFile("src/app/globals.css");
  assert.match(globals, /:focus-visible\s*\{[^}]*outline:\s*2px solid/);
  assert.match(readProjectFile("src/components/HomeClient.tsx"), /href="#mission-control-panel-content"/);
});

test("names toggles by the state they switch on and keeps visible text in the name", () => {
  const language = readProjectFile("src/components/ui/LanguageToggle.tsx");
  assert.match(language, /lang=\{/);
  assert.match(language, /sr-only/);
  const timeline = readProjectFile("src/components/map/GlobalTimelineControl.tsx");
  // The methodology must reach assistive technology, not only a hover title.
  assert.match(timeline, /<input[^>]*aria-describedby="global-timeline-methodology"/);
  assert.match(timeline, /id="global-timeline-methodology"[^>]*>\{t\.timeline\.methodologyText\}/);
  assert.match(timeline, /aria-label=\{`\$\{t\.timeline\.expandLabel\}, \$\{currentLabel\}`\}/);
});

test("offers a keyboard route to individual detections without the map canvas", () => {
  const overview = readProjectFile("src/components/panel/GlobalOverview.tsx");
  assert.match(overview, /onSelectDetection/);
  assert.match(overview, /<button\b/);
});

test("does not overstate what the data is", () => {
  const layout = readProjectFile("src/app/layout.tsx");
  assert.doesNotMatch(layout, /(?<!quase )em tempo real/i);
  assert.doesNotMatch(layout, /em direto/i);

  const pt = readProjectFile("src/lib/i18n/pt.ts");
  const en = readProjectFile("src/lib/i18n/en.ts");
  assert.doesNotMatch(pt, /"Direto"|em direto|Grande evento|Todos os focos|impacto na saúde/i);
  assert.doesNotMatch(en, /"Live"|Live conditions|Major fire event|All fires currently|health impact/i);

  const panel = readProjectFile("src/components/panel/FireDetailsPanel.tsx");
  assert.doesNotMatch(panel, /:\s*selection\.name\b/, "the raw English event name must not reach the panel heading");
});

test("credits third-party imagery and data the way their licences ask", () => {
  assert.match(readProjectFile("src/components/map/satelliteLayers.ts"), /Powered by Esri/);
  const telemetry = readProjectFile("src/components/panel/FireTelemetryDashboard.tsx");
  assert.match(telemetry, /href="https:\/\/open-meteo\.com\/"/);
});

test("sets no cookies and loads no tracking or advertising scripts", () => {
  const forbidden = /document\.cookie|from "next\/headers"|googletagmanager|google-analytics|gtag\(|plausible|posthog|mixpanel|hotjar|adsbygoogle|facebook\.net/;
  for (const path of sourceFiles) {
    assert.doesNotMatch(readProjectFile(path), forbidden, `${relative(projectRoot, join(projectRoot, path))} adds tracking or cookies`);
  }
});

test("keeps satellite heat detections apart from fire severity and operational status", () => {
  const types = readProjectFile("src/lib/wildfire/types.ts");
  assert.doesNotMatch(types, /\bseverity\??:|FireSeverity/i, "FRP bands must not be modelled as severity");
  assert.match(types, /operationalStatus: OperationalStatus/);

  for (const dictionary of ["src/lib/i18n/pt.ts", "src/lib/i18n/en.ts"]) {
    assert.doesNotMatch(readProjectFile(dictionary), /severity|severidade|gravidade/i, `${dictionary} grades detections as fire severity`);
  }

  const selection = readProjectFile("src/lib/wildfire/selection.ts");
  assert.doesNotMatch(selection, /operationalStatus: "(?:active|contained|extinguished)"/, "satellite selections must stay unknown");

  const panel = readProjectFile("src/components/panel/FireDetailsPanel.tsx");
  assert.match(panel, /t\.operationalStatus\[selection\.operationalStatus\]/);
  assert.match(panel, /t\.fireDetail\.operationalUnknownNote/);
  assert.match(panel, /<BasisTag basis="estimated" \/>/, "the burned-area figure must be labelled as an estimate");
});
