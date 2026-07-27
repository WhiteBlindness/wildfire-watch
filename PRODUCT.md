# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primarily (~90%) general public and wildfire-curious visitors checking on fires near them or in the news, the way people check Flightradar24 out of curiosity — casual, not logged in, PT-PT first. Secondarily, civil protection / emergency-response professionals may use it as a lightweight secondary reference, not their primary operational tool.

## Product Purpose

Make global wildfire activity visible and understandable at a glance, in real time, on a single full-screen map. Built as a personal portfolio project to demonstrate full-stack engineering and data-aggregation/mapping craft — success is shipping a real, working, polished product, not hitting business metrics.

## Positioning

An aggregator that normalizes wildly different wildfire data sources (NASA FIRMS, EFFIS, local civil protection feeds) into one consistent internal schema and UI. A competing hobby project that just embeds one feed's widget can't match the same cross-source coverage or the ability to swap sources without touching the UI.

## Operating Context

- Full-screen interactive world map (Flightradar24-style), heatmap hotspots + burned-area polygons.
- Click a fire → sliding side panel (desktop) / bottom drawer (mobile): status, severity, area, wind, forces deployed, international aid, evolution chart.
- UI language is European Portuguese (PT-PT) throughout.
- Dark mode is the default (cinematic look for heatmaps/fire borders); light mode toggle available.
- Deployed on Cloudflare (Workers via OpenNext adapter, free tier), ad slots reserved for future AdSense placements.

## Capabilities and Constraints

- Next.js App Router + TypeScript, MapLibre GL JS (via react-map-gl), Recharts, Tailwind CSS.
- `WildfireDataAdapter` interface currently backed only by a deterministic mock generator (`src/lib/wildfire`); UI never assumes a single source's shape.
- Real API adapters (NASA FIRMS, EFFIS, Portuguese civil protection/ANEPC) are a confirmed near-term goal — not yet implemented, no API keys/access secured yet.
- Must stay Cloudflare Workers/edge-compatible: no Node.js built-ins (`fs`, `path`, etc.) in server code.

## Brand Commitments

- Name: WildfireWatch.
- UI copy is European Portuguese (PT-PT), not Brazilian Portuguese.
- Dark, cinematic default theme is an intentional identity choice, not just a placeholder.

## Evidence on Hand

None yet. All fire data currently shown is synthetic (deterministic mock generator) — it must never be presented as, or visually indistinguishable from, real/live incident data until real adapters ship.

## Product Principles

1. Data source-agnostic by design — the UI must never hard-code assumptions from one feed's shape.
2. Clarity at a glance over density — a casual visitor should read a fire's severity and status within seconds.
3. Free-tier-first engineering — every infra choice (Cloudflare, open-source map stack) optimizes for near-zero hosting cost.
4. Honesty about data provenance — mock and real data are never allowed to blur together.
5. Portfolio-grade craft — built to demonstrate real full-stack ability, not just a demo.
