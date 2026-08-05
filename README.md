# WildfireWatch

A full-screen map of global wildfire activity, updated hourly from NASA FIRMS satellite detections.

**Live:** https://wildfire-watch.duartemonteiro.workers.dev

Click any fire to open a panel with its status, severity, estimated area, wind conditions and nearby air quality. Interface in European Portuguese and English, dark by default.

## Motivation

Portugal burns every summer, and the information about it arrives scattered — a news ticker here, a civil protection PDF there, a satellite portal built for researchers rather than for someone wondering whether the smoke on the horizon matters. Meanwhile Flightradar24 has trained everyone to expect that you can just *look at a map* and understand a live global system in ten seconds.

That gap is the whole project: take fire data that already exists in the open and make it legible at a glance, for a casual visitor, in their own language.

It is also deliberately a portfolio piece. Success means a real, working, polished product running on real data — not a demo with a "coming soon" behind every button.

## Problems worth solving

**The global feed is too big for a browser.** FIRMS returns every thermal anomaly on Earth for the requested window; naively shipping that would be a multi-megabyte payload of mostly redundant points. Downsampling by simple truncation loses whole regions — sort by intensity and Africa's agricultural burns crowd out everything else. The fix is spatial: bucket detections into a 2° grid and keep the strongest per cell, so geographic coverage survives, then reserve a slice of the budget for the highest-radiative-power fires so the genuinely severe ones can never be binned away by a quiet neighbour.

**Satellites report pixels, not fires.** FIRMS gives isolated hot points. Humans think in incidents. Detections have to be clustered into fires, wrapped in a concave hull to suggest a burned area, and aged out as they go stale — none of which the source does for you.

**A page load must never wait on NASA.** The upstream API is slow and rate-limited. An hourly Worker cron decouples them: ingestion writes a processed payload to KV, requests only ever read KV. Users never feel the upstream latency, and the map key is never exposed.

**The edge has no Node.** Running Next.js on Cloudflare Workers via OpenNext means no `fs`, no `path`, no Node built-ins anywhere in server code — a constraint that has to be honoured in every dependency choice, not just your own files.

**Portuguese is not one language.** The UI is European Portuguese, and the most common way that slips is a stray Brazilian form or a gerund construction. That's guarded by a test (`npm run test:language`) rather than by vigilance.

## Why it's built this way

Wildfire data sources disagree about almost everything — field names, units, confidence scales, update cadence, geographic coverage. The usual result is a UI welded to whichever feed it started with.

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

Live FIRMS data needs a NASA map key in `FIRMS_MAP_KEY` (free, from firms.modaps.eosdis.nasa.gov). Without one, set `DATA_SOURCE=mock` in `wrangler.jsonc` to run against the deterministic mock generator — same schema, no network, useful for UI work.

```bash
npm run test:sampling    # ingest downsampling
npm run test:temporal    # detection ageing
npm run test:air-quality
npm run test:language    # guards PT-PT copy against Brazilian forms

npm run deploy           # build + ship to Cloudflare
```

## Status

Live on FIRMS data. EFFIS and ANEPC adapters are the next ones planned — the seams are already there.
