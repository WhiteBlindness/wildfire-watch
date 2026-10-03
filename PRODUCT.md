# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primarily (~90%) general public and wildfire-curious visitors checking on fires near them or in the news, the way people check Flightradar24 out of curiosity — casual, not logged in, PT-PT first. Secondarily, civil protection / emergency-response professionals may use it as a lightweight secondary reference, not their primary operational tool.

## Product Purpose

Make global fire activity seen from space visible and understandable at a glance, in near real time (satellite detections arrive hours late), on a single full-screen map, while being explicit about what a satellite can and cannot know. Built as a personal portfolio project to demonstrate full-stack, geospatial and data-provenance engineering. Success is shipping a real, working, trustworthy product, not hitting business metrics.

## Positioning

A normalising layer between fire data sources and the people reading them. Today it shows NASA FIRMS satellite detections; the model already separates observations, derived values and operational status, so an operational source (EFFIS or the Portuguese civil protection, ANEPC) can be added as an adapter without changing the UI or blurring what each source actually says. A hobby project that embeds one feed's widget cannot do that.

## Operating Context

- Full-screen interactive world map (Flightradar24-style): clustered detection markers coloured by radiative power, and sensor-pixel footprints at detail zoom.
- Select a detection or cluster (on the map, or from the panel's keyboard-accessible list of the strongest detections) → side panel (desktop) / bottom sheet (mobile): measured radiative power, the source's confidence category, acquisition times, provenance, a labelled burned-area estimate, model weather, the nearest air-quality reading and related news. Operational status is shown as unknown, with the reason; deployed forces and containment are not observable from satellites and are not shown.
- The overview always states whether the data is current, the refresh is failing, or the snapshot is out of date.
- UI language is European Portuguese (PT-PT) throughout.
- Dark mode is the default (cinematic look for the glowing detections); light mode toggle available.
- Deployed on Cloudflare (Workers via OpenNext adapter, free tier). Any future advertising requires a consent banner and a privacy-policy update first; today the site sets no cookies.

## Capabilities and Constraints

- Next.js App Router + TypeScript, MapLibre GL JS (via react-map-gl), Tailwind CSS.
- A normalised model (`src/lib/wildfire/types.ts`) of thermal detections, dataset provenance and feed health; the FIRMS adapter maps the KV snapshot into it, and the UI never parses a provider format.
- EFFIS and Portuguese civil protection (ANEPC) adapters are planned, not implemented.
- End-to-end tests run against the production build with synthetic data (`e2e/`); they never stand in for real data in the product.
- Must stay Cloudflare Workers/edge-compatible: no Node.js built-ins (`fs`, `path`, etc.) in server code.

## Brand Commitments

- Name: WildfireWatch.
- UI copy is European Portuguese (PT-PT), not Brazilian Portuguese.
- Dark, cinematic default theme is an intentional identity choice, not just a placeholder.

## Evidence on Hand

Live NASA FIRMS VIIRS detections, refreshed hourly into Workers KV, with the refresh's health recorded beside the snapshot. Synthetic data exists only in the end-to-end test suite. The site is unofficial and must say so, with a pointer to 112 and the civil protection authority, wherever fire data is shown.

## Product Principles

1. Data source-agnostic by design — the UI must never hard-code assumptions from one feed's shape.
2. Clarity at a glance over density — a casual visitor should read a detection's radiative power and how current the data is within seconds.
3. Free-tier-first engineering — every infra choice (Cloudflare, open-source map stack) optimizes for near-zero hosting cost.
4. Honesty about data provenance — measured, estimated and operational information never blur together, and every value can say where it came from.
5. Portfolio-grade craft — built to demonstrate real full-stack ability, not just a demo.
