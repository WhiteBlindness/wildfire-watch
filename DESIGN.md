---
name: WildfireWatch
description: Satellite fire detections on a global map, rendered like a midnight mission-control room
colors:
  alert-red: "#ef4444"
  critical-crimson: "#b91c1c"
  amber-watch: "#f5c451"
  signal-amber: "#f59e0b"
  void-black: "#0a0d12"
  deep-airspace: "#0f172a"
  instrument-panel: "#12161d"
  panel-recess: "#1a1f28"
  hairline-steel: "#262c37"
  signal-white: "#e8eaed"
  daylight-bg: "#f5f6f7"
  daylight-surface: "#ffffff"
  daylight-surface-muted: "#eceef1"
  daylight-border: "#d8dbe0"
  daylight-ink: "#12151a"
typography:
  title:
    fontFamily: "Geist Sans, Arial, Helvetica, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Geist Sans, Arial, Helvetica, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist Sans, Arial, Helvetica, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.05em"
  data:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontVariantNumeric: "tabular-nums"
rounded:
  control: "6px"
  card: "8px"
  panel: "16px"
  full: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
components:
  feed-health-badge:
    textColor: "{colors.signal-white}"
    rounded: "{rounded.full}"
    padding: "0"
  basis-tag:
    backgroundColor: "rgba(10,13,18,0.55)"
    textColor: "{colors.signal-white}"
    rounded: "{rounded.full}"
    padding: "2px 6px"
  operational-status:
    backgroundColor: "{colors.panel-recess}"
    textColor: "{colors.signal-white}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
---

# Design System: WildfireWatch

## Overview

**Creative North Star: "Mission Control at Midnight"**

WildfireWatch reads like the main display wall of a night-shift operations room: a near-black world map as the permanent canvas, satellite heat detections as the only warm light source, and every floating panel a piece of glass instrumentation hovering over that canvas rather than a page of content beside it. The dark theme is the primary, intentional world; light mode is a daylight-shift variant, not the default identity.

Nothing on screen competes with the detections for attention. Chrome (top bar, legend, timeline, side panel) is deliberately quiet: translucent, blurred, low-contrast, so the map's markers and pixel footprints are always the brightest, most saturated things visible.

The interface is honest about what a satellite can know. A detection is heat measured from orbit, not a confirmed incident: it is coloured by measured radiative power, never by "severity", and its operational status is shown as unknown because only an authority can report it. Every figure in the detail panel carries its basis (measured, reported by the source, estimated, inferred).

**Key Characteristics:**
- Dark-first: void-black canvas, glass-panel chrome, glow-driven depth instead of drop shadows.
- One colour language for meaning: the four-step radiative-intensity ramp. Never introduce a second accent hue for decoration.
- Floating, translucent surfaces read as instruments layered over the map, not as a separate page.
- Data status is always visible: the overview says whether the snapshot is current, the refresh is failing, or the data is out of date.

## Colors

The palette has one job: make a detection's radiative power readable in under a second, day or night, without implying how dangerous a fire is.

### Primary (the intensity ramp)
- **Amber Watch** (`#f5c451`): below 10 MW.
- **Signal Amber** (`#f59e0b`): 10–49 MW.
- **Alert Red** (`#ef4444`): 50–149 MW; also the wordmark dot and the selected-detection accent.
- **Critical Crimson** (`#b91c1c`): 150 MW or more, the darkest step.

The thresholds live in `src/lib/wildfire/firms-dataset.ts` and the colours in `src/lib/wildfire/colors.ts`; the legend reads both.

### Status tones
- Data-health warnings (refresh failing, out-of-date data) use amber text with an amber dot; an unavailable source uses red. Current data stays neutral. These tones describe the pipeline, never a fire.
- Air-quality categories use the conventional AQI colours inside their own card, which never sits next to the intensity ramp.

### Neutral (dark, default world)
- **Void Black** (`#0a0d12`): page background.
- **Deep Airspace** (`#0f172a`): the MapLibre canvas background, pinned independently of the page background so the map reads as a distinct instrument.
- **Instrument Panel** (`#12161d`): floating surface fill (side panel, before translucency is applied).
- **Panel Recess** (`#1a1f28`): recessed or grouped content fill (stat groups, the operational-status card).
- **Hairline Steel** (`#262c37`): borders and dividers.
- **Signal White** (`#e8eaed`): primary text.

### Neutral (light, daylight-shift variant)
- **Daylight Ink** (`#12151a`) on **Daylight Surface** (`#ffffff`), background (`#f5f6f7`), muted fill (`#eceef1`), border (`#d8dbe0`). Same structural roles as the dark palette, swapped via a `.dark` class rather than `prefers-color-scheme`, so the toggle is explicit and user-controlled.

### Named Rules
**The One Ramp Rule.** All intensity meaning flows through exactly one four-step ramp (Amber Watch → Signal Amber → Alert Red → Critical Crimson). No other hue is added for "visual interest", and the ramp is never relabelled as severity.

**The 60 % Floor.** Secondary text never drops below 60 % foreground opacity, the lowest value that keeps 4.5:1 contrast on every panel surface in light mode. A static test enforces it.

## Typography

**Display/Body Font:** Geist Sans (with Arial, Helvetica, sans-serif fallback)
**Mono Font:** JetBrains Mono (loaded for data, telemetry, coordinates, times, measurements, and status badges)

**Character:** Geist Sans remains the clean reading face for titles, labels and prose. JetBrains Mono is the dedicated instrument face for changing operational data, keeping measurements and timestamps stable without turning ordinary copy into technical decoration.

### Hierarchy
- **Title** (600, 1.125rem/18px, 1.4 line-height): the detail-panel heading ("Satellite-detected thermal anomaly" or "Detection cluster").
- **Body** (400, 0.875rem/14px, 1.5 line-height): stat values and panel copy.
- **Label** (600, 0.6875rem/11px, uppercase, 0.05em tracking): section eyebrows ("Satellite observation", "Where this comes from").
- **Data** (JetBrains Mono, tabular numerals): coordinates, times, measurements, telemetry readouts, basis tags and status badges; prose and descriptive labels remain Geist Sans.

Numbers follow the interface language: a decimal comma and a non-breaking-space thousands separator in Portuguese, dates as DD/MM/YYYY in both languages (`src/lib/i18n/format.ts`).

### Named Rules
**The Uppercase Eyebrow Rule.** Any label introducing a data group is uppercase, tracked, and rendered at reduced opacity relative to body copy: it organises without competing.

## Layout

Full-bleed, single-viewport app: the map fills the viewport and every other surface is a fixed-position overlay on top of it (`body { overflow: hidden }`, no page scroll). A skip link is the first focusable element and moves focus into the panel.

- **Top bar**: fixed top, wordmark pill left; satellite, language and theme toggles right.
- **Timeline**: a compact detection-timeline control (72 hours to now) near the top on mobile and the bottom on desktop.
- **Legend**: fixed bottom-left on desktop, labelled "Radiative power (FRP)".
- **Side panel**: a bottom sheet on mobile that starts collapsed so the map is visible first, and a right-hand sidebar on desktop (`md:w-[400px]`). It shows the global overview (data status, scope selector, metrics, strongest detections) or a detection's detail. Every view ends with the emergency notice and links to the legal pages.

Spacing rhythm is tight and consistent: `8px` (icon-to-label gaps), `12px` (overlay edge padding, mobile), `16px` (overlay edge padding, desktop; card internal padding), `20px` (detail-panel internal gap).

## Elevation & Depth

Depth comes from two mechanisms rather than a drop-shadow scale:

1. **Glass, not shadow.** Every floating chrome surface is translucent and blurred (`backdrop-blur`, `bg-surface/75–90`) rather than opaque with a shadow. The map stays visible through the instrumentation.
2. **Glow, not shadow, for the map itself.** Cluster markers carry a soft glow ring under the solid marker, and selected pixel footprints are drawn as bright, saturated cells. Light is the depth cue.

Ordinary `shadow-lg` still appears on floating panels as a secondary lift, so edges separate from busy map content behind them.

### Named Rules
**The Glow-Over-Shadow Rule.** When something needs to feel elevated, reach for glow (blur + saturated colour) before a drop shadow. Shadows are structural; glow marks where the heat is.

## Shapes

- **Full round (`9999px`)**: every pill and toggle: status badges, basis tags, the wordmark chip, toggle tracks and thumbs, legend dots, map markers.
- **Panel radius (`16px` / `rounded-2xl`)**: the side panel's outer corners.
- **Card radius (`8px` / `rounded-lg` / `rounded-xl`)**: grouped stat blocks, the legend card, data cards.
- Borders are hairline (`1px`) and low-contrast (`border-border`).

## Components

### Data-health badge
- Mono, uppercase, with a small dot; announced politely to assistive technology when it changes.
- States: loading, current data, refresh failing, out-of-date data, source unavailable. A sentence beneath explains the state with times ("The latest refresh failed. Showing the last successful snapshot, from 02/10/2026, 13:00.").
- Snapshot age and refresh health are separate facts: a snapshot ten minutes old after a failed refresh reads as "refresh failing", not "current".

### Basis tags
- Small mono pills next to a value's label: Measured, Reported by source, Estimate, Inferred. Every figure in the detection detail has one where the distinction matters.

### Operational-status card
- A recessed card at the top of the detection detail with a neutral pill reading "Unknown" and one sentence explaining that satellites measure heat and only authorities know whether a fire is active, contained or out. No red, amber or green status colours: those would imply knowledge the data does not contain.

### Detail panel (signature component)
- **Surface:** `bg-surface/75` + `backdrop-blur-xl`, hairline `border-border/60`.
- **Structure, top to bottom:** back link → technical readout (nearest place, acquisition time in UTC, burned-area estimate with its method) → heading and close button → operational-status card → satellite observation (FRP, confidence or detection count, acquisition times, coordinates, country) → provenance (provider and product, instrument, acquisition, retrieval and processing times, attribution) → air quality → model weather → news → legal footer.
- **Close control:** a bordered circular icon button, top-right.

### Map layers
- **Markers and clusters:** MapLibre clusters group nearby detections at low zoom; single detections are filled circles coloured by intensity band. Clusters are a display grouping, never presented as incidents.
- **Pixel footprints:** at detail zoom, each detection is drawn as its sensor pixel using the scan and track size FIRMS reports (nominally 375 m). They are explicitly not fire perimeters.
- **Base styles:** CARTO dark-matter (dark) and positron (light) vector tiles; optional Esri World Imagery under CARTO labels in satellite mode.

### Navigation
- No traditional nav; the top bar's controls are `pointer-events-auto` islands inside an otherwise `pointer-events-none` header strip, so map panning underneath is never blocked.

## Do's and Don'ts

### Do:
- **Do** keep dark as the default, primary world.
- **Do** route all intensity meaning through the One Ramp and call it radiative power.
- **Do** label estimates as estimates, with the method one tap or one line away.
- **Do** show the data's age and refresh state wherever the overview is shown.

### Don't:
- **Don't** describe a satellite detection as an active, contained or extinguished fire, or grade it by severity.
- **Don't** let synthetic test data look like live data outside the test suite.
- **Don't** add a second decorative accent colour outside the intensity ramp.
- **Don't** make drop shadow the primary elevation cue on the map or its overlays.
