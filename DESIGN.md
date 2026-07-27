---
name: WildfireWatch
description: Real-time global wildfire monitoring, rendered like a midnight mission-control room
colors:
  alert-red: "#ef4444"
  critical-crimson: "#b91c1c"
  amber-watch: "#f5c451"
  signal-amber: "#f59e0b"
  flare-red: "#ff3b3b"
  resolved-emerald: "#10b981"
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
  badge-active:
    backgroundColor: "rgba(239,68,68,0.15)"
    textColor: "{colors.alert-red}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  badge-contained:
    backgroundColor: "rgba(245,158,11,0.15)"
    textColor: "{colors.signal-amber}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  badge-extinguished:
    backgroundColor: "rgba(16,185,129,0.15)"
    textColor: "{colors.resolved-emerald}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  ad-slot:
    backgroundColor: "{colors.panel-recess}"
    textColor: "{colors.signal-white}"
    rounded: "{rounded.card}"
    padding: "8px"
---

# Design System: WildfireWatch

## Overview

**Creative North Star: "Mission Control at Midnight"**

WildfireWatch reads like the main display wall of a night-shift operations room: a near-black world map as the permanent canvas, glowing hotspots as the only warm light source, and every floating panel a piece of glass instrumentation hovering over that canvas rather than a page of content sitting beside it. The dark theme is the primary, intentional world — light mode exists as a daylight-shift variant, not the default identity.

Nothing on screen competes with the fire data for attention. Chrome (top bar, legend, side panel, ad slots) is deliberately quiet — translucent, blurred, low-contrast — so the map's heatmap glow and burned-area borders are always the brightest, most saturated things visible. Ad slots are the most visually recessive element in the system on purpose: dashed borders, muted fill, uppercase micro-label. They must never be mistaken for data.

Component language is tactile and precise: crisp pill shapes, confident status-color contrast, glass surfaces that behave like real HUD panels built for fast scanning under pressure, not a soft consumer-app feel.

**Key Characteristics:**
- Dark-first: void-black canvas, glass-panel chrome, glow-driven depth instead of drop shadows.
- One color language for meaning (the four-step severity ramp) — never introduce a second accent hue for decoration.
- Floating, translucent surfaces (top bar, legend, side panel) read as instruments layered over the map, not as a separate page.
- Ad slots are structurally and visually separated from data at every density.

## Colors

The palette has exactly one job: make a fire's severity readable in under a second, day or night.

### Primary
- **Alert Red** (`#ef4444`): the product's core accent — wordmark dot, "Ativo" status badge, high-severity fill/stroke/marker color. This is the color WildfireWatch is "the red one."
- **Critical Crimson** (`#b91c1c`): extreme-severity fill, stroke, and marker color — the darkest, most saturated step in the ramp, reserved for the worst-case state.
- **Amber Watch** (`#f5c451`) / **Signal Amber** (`#f59e0b`): low- and moderate-severity steps respectively; also the international-aid banner's accent (reuses `signal-amber` rather than a new hue).
- **Flare Red** (`#ff3b3b`): the bright, saturated stroke color for burned-area polygon borders on high/extreme fires — never used as a fill, only as the "hot edge" line.

### Tertiary
- **Resolved Emerald** (`#10b981`): the one hue outside the severity ramp, reserved exclusively for the "Extinto" status badge. Signals "this is over," which the red-to-amber ramp structurally cannot say.

### Neutral (dark, default world)
- **Void Black** (`#0a0d12`): page background.
- **Deep Airspace** (`#0f172a`): the MapLibre canvas's own background layer, pinned independently of the page background so the map reads as a distinct instrument rather than just "more page."
- **Instrument Panel** (`#12161d`): floating surface fill (side panel, before translucency is applied).
- **Panel Recess** (`#1a1f28`): recessed/grouped content fill (stat groups, ad slots).
- **Hairline Steel** (`#262c37`): borders and dividers.
- **Signal White** (`#e8eaed`): primary text.

### Neutral (light, daylight-shift variant)
- **Daylight Ink** (`#12151a`) on **Daylight Surface** (`#ffffff`), background (`#f5f6f7`), muted fill (`#eceef1`), border (`#d8dbe0`). Same structural roles as the dark palette, swapped via a `.dark` class rather than `prefers-color-scheme`, so the toggle is explicit and user-controlled.

### Named Rules
**The One Ramp Rule.** All status/severity meaning flows through exactly one four-step ramp (Amber Watch → Signal Amber → Alert Red → Critical Crimson) plus the single Resolved Emerald exception. No other hue is ever added for "visual interest."

## Typography

**Display/Body Font:** Geist Sans (with Arial, Helvetica, sans-serif fallback)
**Mono Font:** Geist Mono (loaded, reserved for future data/coordinate readouts)

**Character:** A clean, geometric grotesque doing double duty as both the operator's dashboard face and the reading face — no separate decorative display font, because nothing on this surface is editorial.

### Hierarchy
- **Title** (600, 1.125rem/18px, 1.4 line-height): fire name in the detail panel header — the single largest, boldest text on the page.
- **Body** (400, 0.875rem/14px, 1.5 line-height): stat values, panel copy, chart tooltips.
- **Label** (600, 0.6875rem/11px, uppercase, 0.05em tracking): section eyebrows ("MEIOS NO TERRENO", "SEVERIDADE", "EVOLUÇÃO DA ÁREA ARDIDA") and the ad-slot micro-label.

### Named Rules
**The Uppercase Eyebrow Rule.** Any label introducing a data group is uppercase, tracked, and rendered at ~50% text opacity relative to body copy — it organizes without competing.

## Layout

Full-bleed, single-viewport app: the map fills `100vw × 100vh` and every other surface is a `fixed`-position overlay on top of it, not a document in normal flow (`body { overflow: hidden }`, no page scroll).

- **Top bar**: fixed top, wordmark pill left, theme toggle right, `p-3` mobile / `p-4` desktop.
- **Legend + sidebar ad**: fixed bottom row, legend left, `sidebar-banner` ad slot right, desktop-only (`hidden md:block`).
- **Detail panel**: bottom sheet on mobile (`max-h-[75vh]`, full width, slides up), right-hand fixed sidebar on desktop (`md:w-[400px]`, full height, slides in from the right). Same component, two placements — no separate mobile layout to maintain.
- **Mobile leaderboard ad**: fixed bottom-center, mobile only, hidden whenever the detail panel is open (never stacks two floating surfaces at the same edge).

Spacing rhythm is tight and consistent: `8px` (icon-to-label gaps), `12px` (overlay edge padding, mobile), `16px` (overlay edge padding, desktop; card internal padding), `20px` (detail-panel internal gap).

## Elevation & Depth

WildfireWatch does not use a traditional drop-shadow scale as its primary depth cue. Depth comes from two mechanisms instead:

1. **Glass, not shadow.** Every floating chrome surface (top bar, legend, detail panel) is translucent + blurred (`backdrop-blur`, `bg-surface/75–90`) rather than opaque-with-shadow. The map is meant to stay visible through the instrumentation.
2. **Glow, not shadow, for the map itself.** Fire intensity reads through a two-layer heatmap (a wide, soft, low-opacity "glow" pass underneath a tighter, brighter core pass) and burned-area polygons carry a blurred glow line under their solid bright stroke (`line-blur: 4`, `line-opacity: 0.5`). Light is the depth cue, not shadow.

Ordinary Tailwind `shadow-lg` / `shadow-2xl` still appear on floating panels as a secondary, understated lift — they exist so edges separate from busy map content behind them, not as the main elevation language.

### Named Rules
**The Glow-Over-Shadow Rule.** When something needs to feel "elevated" or "urgent," reach for glow (blur + saturated color) before reaching for a drop shadow. Shadows are structural (separate this panel from that map); glow is meaningful (this is where the fire is).

## Shapes

- **Full round (`9999px`)**: every pill and toggle — status badges, the wordmark chip, the theme-toggle track and thumb, severity legend dots, map circle markers.
- **Panel radius (`16px` / `rounded-2xl`)**: the detail panel's outer corners — top corners only on the mobile bottom-sheet, left corners only on the desktop sidebar.
- **Card radius (`8px` / `rounded-lg` / `rounded-xl`)**: grouped stat blocks, the legend card, ad-slot borders.
- Borders are hairline (`1px`) and low-contrast (`border-border`, ~10–20% perceived opacity via the neutral border token); no heavy strokes anywhere except the map's severity-colored polygon outlines, which are the one place a bold, saturated line is correct.

## Components

### Status Badges
- **Shape:** full pill, `4px 10px` padding, `0.6875rem` medium-weight text.
- **Active (Ativo):** `rgba(239,68,68,0.15)` fill, Alert Red text, matching 40%-opacity ring.
- **Contained (Dominado):** `rgba(245,158,11,0.15)` fill, Signal Amber text.
- **Extinguished (Extinto):** `rgba(16,185,129,0.15)` fill, Resolved Emerald text.
- A plain severity pill (`bg-surface-muted`, neutral text) always sits beside the status pill — status and severity are always shown as a pair, never status alone.

### Detail Panel (signature component)
- **Surface:** `bg-surface/75` + `backdrop-blur-xl`, hairline `border-border/60` — the system's clearest glass instance.
- **Placement:** bottom sheet (mobile) / right sidebar (desktop), see Layout.
- **Internal structure, top to bottom:** name + region header → status/severity badge pair → 2-column stat grid (area, start/containment, wind) → recessed "Meios no terreno" stat card → conditional amber international-aid callout → evolution chart → ad slot pinned to the bottom via `mt-auto`.
- **Close control:** a bordered circular icon button, top-right, always reachable regardless of scroll position.

### Ad Slots
- **Style:** dashed `border-border`, `bg-surface-muted/60`, `rounded-md`, centered uppercase micro-label reading "Publicidade · WxH", text at ~40% foreground opacity.
- **Placement rule:** desktop sidebar-banner (300×100) bottom-right beside the legend; panel-rectangle (300×250) pinned to the bottom of the detail panel; mobile-leaderboard (320×50) bottom-center, only when the panel is closed.
- Ad slots never sit inside the same visual card as fire data — always their own bordered box.

### Map Layers
- **Heatmap:** two stacked layers — a wide (`radius: 55`), low-opacity (`0.45`) glow pass in orange-to-crimson, plus a tighter (`radius: 20`), brighter (`0.9`) core pass ramping yellow → amber → Alert Red → Critical Crimson → a pale hot-core yellow at peak density.
- **Burned-area polygons:** severity-colored fill at `0.32` opacity, a blurred glow line underneath, and a solid Flare-Red (high/extreme) or severity-colored (moderate/low) stroke on top.
- **Fire markers:** severity-colored filled circles, white stroke, radius/stroke-width both step up when selected (`7px → 11px` radius, `1.5px → 3px` stroke) — the only size-based (not just color-based) selection cue on the map.
- **Base style:** CARTO dark-matter (dark) / positron (light) vector tiles, with the dark style's background layer explicitly repainted to Deep Airspace (`#0f172a`) on load rather than trusting the upstream default.

### Navigation
- No traditional nav; the top bar is a single wordmark pill (left) and theme toggle (right), both floating, both `pointer-events-auto` islands inside an otherwise `pointer-events-none` header strip so map panning underneath is never blocked.

## Do's and Don'ts

### Do:
- **Do** keep dark as the default, primary world; treat light mode as a secondary daylight-shift variant, not co-equal.
- **Do** route all status/severity meaning through the One Ramp (plus Resolved Emerald) — never invent a new hue for a new state.
- **Do** use glass (blur + translucency) for chrome that floats over the map; reach for glow (blur + saturated color), not drop shadow, when something needs to feel urgent or elevated.
- **Do** keep ad slots visually recessive (dashed border, muted fill, micro-label) and structurally separate from data cards at every breakpoint.
- **Do** show status and severity as a paired badge, never status alone.

### Don't:
- **Don't** let mock/synthetic data look or read as indistinguishable from real live data — no fabricated "LIVE" indicators or real-time-looking timestamps beyond what the mock generator actually produces.
- **Don't** add a second decorative accent color outside the severity ramp.
- **Don't** make drop shadow the primary elevation cue on the map or its overlays — glow and blur carry that job here.
- **Don't** give an ad slot the same card treatment (solid fill, solid border, drop shadow) as a data card; the dashed/muted treatment is the whole point.
