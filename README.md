# WildfireWatch

A full-screen map of global wildfire activity, updated hourly from NASA FIRMS satellite detections.

**Live:** https://wildfire-watch.duartemonteiro.workers.dev

**Status:** Live. The page loaded during the last check, but the FIRMS feed was still waiting for data.

Click any fire to open a panel with its status, severity, estimated area, wind conditions and nearby air quality. Interface in European Portuguese and English, dark by default.

## Motivation

Portugal burns every summer, but information about a fire can be hard to piece together. It may be split between news tickers, civil protection PDFs, and satellite portals built for researchers rather than people trying to understand smoke on the horizon. Meanwhile, Flightradar24 has shown people that a live system can be understood by looking at a map.

That gap is the whole project: take fire data that already exists in the open and make it legible at a glance, for a casual visitor, in their own language.

This is also a portfolio project. The goal is a working product that uses real data, not a demo with a "coming soon" label behind every button.

## Problems worth solving

**The global feed is too big for a browser.** FIRMS returns every thermal anomaly on Earth for the requested window, which can create a multi-megabyte payload full of redundant points. Simple truncation can drop whole regions. Sorting by intensity alone would let agricultural burns in Africa crowd out other detections. Instead, the Worker groups detections into a 2° grid and keeps the strongest point in each cell. It then reserves part of the data budget for fires with the highest radiative power.

**Satellites report pixels, not fires.** FIRMS provides isolated hot points, while people look for incidents. The app clusters detections into fire groups, builds a concave hull to suggest the affected area, and removes detections as they age.

**A page load must never wait on NASA.** The upstream API is slow and rate-limited. An hourly Worker cron decouples them: ingestion writes a processed payload to KV, requests only ever read KV. Users never feel the upstream latency, and the map key is never exposed.

**The edge has no Node.** Running Next.js on Cloudflare Workers through OpenNext means server code cannot rely on Node built-ins such as `fs` or `path`. Every dependency must respect that constraint.

**Portuguese is not one language.** The UI is European Portuguese, and the most common way that slips is a stray Brazilian form or a gerund construction. That's guarded by a test (`npm run test:language`) rather than by vigilance.

## Why it's built this way

Wildfire data sources differ in field names, units, confidence scales, update frequency, and geographic coverage. Without an adapter layer, the interface tends to depend on whichever feed it started with.

Here every source is mapped into one normalized schema (`src/lib/wildfire/types.ts`) before it reaches a component. The map and panel never learn where a fire came from. Adding EFFIS or the Portuguese civil protection feed means writing an adapter, not touching the UI.

```
NASA FIRMS CSV ──┐
EFFIS (planned) ─┼─→ adapter ─→ normalized schema ─→ map / panel
ANEPC (planned) ─┘
```

## How the data flows

A Cloudflare Worker cron job runs hourly (`workers/firms-ingest.ts`), pulls the last three days of VIIRS thermal anomalies for the whole world, and writes a processed payload to KV. The app reads from KV, so a page load never waits on NASA.

The raw global feed is far larger than a browser should receive, so ingestion downsamples it: detections are bucketed into a 2° grid, the strongest are kept per cell, and the result is capped at 6,000 points with 1,500 reserved for the highest-radiative-power fires. Intensity survives; noise doesn't.

Individual detections are then clustered into fires, given a concave hull for their burned-area polygon, and enriched with reverse-geocoded place names, weather and air quality.

## Stack

Next.js App Router · TypeScript · MapLibre GL JS via react-map-gl · Turf.js · Tailwind · shadcn/ui

Deployed to Cloudflare Workers through the OpenNext adapter, which is the constraint that shapes the server code: no Node built-ins, no `fs`, no `path`. Everything runs on free tier.

## Running it

```bash
npm install
npm run dev
```

Live FIRMS data requires a NASA map key in `FIRMS_MAP_KEY` (available free from firms.modaps.eosdis.nasa.gov). Without one, set `DATA_SOURCE=mock` in `wrangler.jsonc` to use the deterministic mock generator. It uses the same schema without a network connection, which is useful for interface work.

```bash
npm run test:sampling    # ingest downsampling
npm run test:temporal    # detection ageing
npm run test:air-quality
npm run test:language    # guards PT-PT copy against Brazilian forms

npm run deploy           # build + ship to Cloudflare
```

## Status

The current live adapter uses FIRMS. EFFIS and ANEPC adapters are planned; the data-source interfaces already allow for them.
