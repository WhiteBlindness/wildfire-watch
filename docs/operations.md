# Operations

How WildfireWatch gets its data, how it knows when that data is wrong, and how it stays inside Cloudflare's free plan. For the legal and third-party side, see [compliance.md](./compliance.md).

## Data flow

```
cron "0 * * * *"            workers/scheduled.ts runs, in order, each step isolated from the others:

NASA FIRMS ──CSV──→ refreshFirmsCache ──→ KV active-fires:v1                     snapshot, last known good
 (world, 3 days)        │                 KV active-fires:ingest-health:v1       health, alert state, daily signals
                        │                 KV active-fires:fusion-index:v1        detections in mainland Portugal, compact
                        │ points (in memory)
                        ▼
ANEPC ArcGIS ──JSON──→ refreshOperationalIncidents ──→ KV operational-incidents:v1                occurrences + reconciliation
 (open occurrences)     (parse, filter, reconcile)     KV operational-incidents:ingest-health:v1  health, alert state, daily signals
                        ▼
                     daily summary, due at 07:00 UTC ──→ KV operations:digest:v1

cron "15,30,45 * * * *"     refreshOperationalIncidents only, reconciling with the stored fusion index

any run ──→ Telegram / Discord (optional): failure, stall, stale data, recovery, daily summary

browser ──→ /api/fires ─────→ FIRMS snapshot + public health ──→ adapter ──→ detections + provenance + health ──┐
browser ──→ /api/incidents ─→ occurrences + reconciliation + public health ─────────────────────────────────────┴─→ map / panel
```

A page load never waits on NASA or ANEPC. The FIRMS snapshot is replaced only by a complete worldwide feed (at least 5 000 points across 8 longitude and 4 latitude bands); anything else is recorded as a failure and the previous snapshot stays. Each source has its own KV keys and health record, so a failing source can never overwrite another's data or hide its state.

The top-of-hour run reconciles ANEPC with the FIRMS points it has just processed, in memory. The quarter-hour runs read the fusion index the last successful FIRMS run stored (detections inside the ANEPC coverage box, as `[id, lat, lng, acquiredAt, frpMw]` tuples). If there is no index, the occurrences are still stored and served, marked as not reconciled.

## Domain model

`src/lib/wildfire/types.ts` keeps three kinds of information apart:

| Kind | Example | Who can provide it |
|---|---|---|
| Observation | A `ThermalDetection`: pixel centre, acquisition time, FRP, the source's confidence category, pixel size | An instrument or authority (today: FIRMS VIIRS) |
| Derived value | FRP intensity band (map colour), country from coordinates, burned-area estimate | WildfireWatch, labelled *estimated* or *inferred* |
| Operational status | `unknown`, `active`, `contained`, `extinguished` | Only an operational source; satellite data alone is always `unknown` |
| Operational incident | An `OperationalIncident`: ANEPC occurrence number, registered location, phase (and ANEPC's own label), nature, start and update times, municipality, parish, resources deployed | ANEPC, mainland Portugal only |

A detection never takes on an incident's fields. The reconciliation stores links and the evidence behind them (`src/lib/fusion/reconcile.ts`); the panel shows the linked occurrence's phase as "reported by ANEPC", next to what the satellite measured.

Provenance is shared, not repeated per point: each detection references a `DatasetId`, and the snapshot carries one `SnapshotProvenance` (provider, product, instrument, attribution, source URL, retrieval and processing times, row counts). The detail panel shows it with the acquisition window of the selection.

## Operational source (ANEPC)

`workers/anepc-ingest.ts` and `src/lib/operational/anepc.ts`.

**What it reads.** ANEPC's public layer of open occurrences, the ArcGIS feature service `OcorrenciasSite` on ArcGIS Online, which fogos.pt and other public projects also read. dados.gov.pt lists the dataset as "ProCiv – Ocorrências em aberto" under CC BY 4.0. One request returns the whole list, typically tens to a few hundred records:

```
GET https://services-eu1.arcgis.com/VlrHb7fn5ewYhX6y/arcgis/rest/services/OcorrenciasSite/FeatureServer/0/query
    ?where=1=1&outFields=*&returnGeometry=true&outSR=4326&f=json
```

The query asks for every field and filters locally, because the layer's field names changed when ANEPC moved it to ArcGIS Online in March 2026 and could not be checked live from the build environment. The parser accepts both known spellings. Once the live check below confirms the schema, a server-side filter (`CodNatureza LIKE '31%'`) and named fields would shrink the response; that is an optimisation, not a requirement.

**What it keeps.** Rural fires only: nature codes 31xx, except 3107 (mop-up consolidation of an earlier fire), 3109 (fuel management) and 3111 (debris burning). Closed occurrences are dropped. The street address is never stored. Each occurrence keeps ANEPC's number, location, phase, nature, start and update times, municipality, parish and resources (personnel, ground vehicles, aircraft; a missing count is "not reported", never zero).

| ANEPC label (`EstadoAgrupado`) | Phase | Shown as |
|---|---|---|
| Em Despacho, Despacho de 1.º Alerta | `dispatch` | Em despacho / Dispatching |
| Em Curso | `in_progress` | Em curso / In progress |
| Em Resolução | `resolving` | Em resolução / Being resolved |
| Em Conclusão | `concluding` | Em conclusão / Concluding |
| Vigilância | `surveillance` | Em vigilância / Under surveillance |
| Encerrada, Fechada | dropped | not shown |
| anything else (for example "Chegada ao TO") | `other` | ANEPC's own label |

**Safeguards.** A 20-second timeout, a 4 MiB cap on the response (declared and actual), an identifying `User-Agent`, and schema checks: a response with no nature codes, or where every rural-fire record is unreadable, is a `parse_error`, not an empty list. Any failure keeps the last good snapshot and records a safe error code (`network`, `http_error` or `parse_error`); upstream response text is never stored or sent. A response flagged as truncated (`exceededTransferLimit`) is kept but counted for the daily summary.

**Coverage.** Mainland Portugal (the layer excludes the Azores and Madeira). A detection is compared with ANEPC only when its inferred country is Portugal and it lies inside the box 36.9–42.2° N, 9.6–6.1° W; anywhere else the panel says no operational source covers the area.

### Before the first deploy

The endpoint, its fields and its time zone were researched from public documentation and from open-source projects that read it, but every request from the build environment was blocked. Before merging, from a machine with normal internet access:

1. `curl -s '<layer URL>?f=pjson' | jq '{name, maxRecordCount, copyrightText, fields: [.fields[].name]}'`: the fields include `Numero`, `EstadoAgrupado`, `DataOcorrencia`, `CodNatureza`, `Natureza`, `Concelho`, `Freguesia`, `Operacionais`, `MeiosTerrestres`, `MeiosAereos` and `DataDosDados`, and `maxRecordCount` is at least a few hundred.
2. Run the query above and check that `features` is non-empty, that `DataOcorrencia` values are epoch milliseconds in UTC (compare one with the ANEPC website), and that the response is well under 4 MiB.
3. Re-read the dataset page on dados.gov.pt and confirm the licence and that this layer is the dataset's resource (see [compliance.md](./compliance.md#operational-data-anepc)).
4. After deploying, `curl -s <site>/api/incidents | jq '{generatedAt, n: (.incidents | length), outcome: .ingestHealth.outcome}'` shows a recent `generatedAt` and `success`.

## Reconciliation

`src/lib/fusion/reconcile.ts`. Deterministic: no probability score, no learned model, and the same two inputs always give the same output, sorted by identifier. Nothing is merged; the result only links records and keeps the evidence.

| Rule | Value | Why |
|---|---|---|
| Candidate distance | within 5 km of the registered location | The registered place is often the nearest locality, not the fire front; VIIRS pixels are about 375 m |
| Candidate time | acquired no more than 6 h before the occurrence started | Heat is often seen before a fire is reported; much older heat belongs to an earlier event |
| Ambiguity | two or more candidates within 1 km of the nearest | The detection is linked to none; both occurrences are listed |
| Recent satellite evidence | a linked detection in the last 12 h | Otherwise "earlier" or "none" |
| Location note | nearest linked detection more than 2 km away | The panel says how far the heat is from the registered place |

Incidents are bucketed in 0.1° cells so each detection is only measured against the incidents around it; a unit test checks that the result is identical to comparing every pair, including at high latitude and across the antimeridian. The rules travel with every snapshot, and the occurrence panel explains them in plain language behind a "How the sources are linked" disclosure.

**What each case looks like** (the states the end-to-end suite covers in `e2e/multisource.spec.ts`):

| Case | Detection panel | Occurrence panel |
|---|---|---|
| One occurrence nearby | Phase badge, "official occurrence 0.5 km away", link to it | Linked detections, latest, strongest, nearest |
| Several detections, one occurrence | Each detection links to it | Count of linked detections, newest first |
| Linked, but more than 2 km from the registered place | Same, with the distance noted | Same note |
| Two occurrences about as close | "Unknown" status, both occurrences listed, neither chosen | "Nearby detections at similar distances from this and another occurrence" |
| Covered, no occurrence within 5 km | "No official occurrence within 5 km", and that a thermal anomaly is not always a fire | n/a |
| Occurrence with no detection | n/a | "No linked satellite detection" and why that can happen (clouds, small or new fires, overpass gaps) |
| Outside mainland Portugal | "No operational source covers this area" | n/a |
| Operational data out of date | Shown, with "may be out of date: last update …" | Same |
| Operational source unavailable | "Operational information unavailable; satellite data unaffected" | The last snapshot received in this visit stays, labelled; an occurrence no longer listed says so |
| FIRMS out of date | The FIRMS badge says so; the reconciliation used the last snapshot it had | Same |

## Feed health

Each source is assessed on its own, with its own timing. Two independent questions, combined only for display (`src/lib/wildfire/feed-health.ts`):

- **Snapshot freshness**: is the data shown older than 90 minutes?
- **Ingest health**: did the latest scheduled refresh work? The KV record counts consecutive failures and keeps the last success time.

| Panel state | When |
|---|---|
| Current data | Fresh snapshot, latest refresh succeeded (or no failure is known) |
| Refresh failing | Fresh snapshot, but the latest refresh failed: "showing the last successful snapshot, from 13:00" |
| Out-of-date data | Snapshot older than 90 minutes, whatever the refresh says; the message adds whether refreshes are failing or have stopped |
| Source unavailable | No usable snapshot |

The ingest is *stalled* when no attempt has been recorded for two hours (for example, runs stopped by a platform limit before they could write). A failure recorded before the current snapshot was built is treated as superseded. Malformed or missing health records degrade to "status unknown"; they never hide the snapshot.

| Timing | FIRMS (hourly) | ANEPC (every 15 min) |
|---|---|---|
| Snapshot shown as out of date after | 90 min | 45 min |
| Refreshes shown as stopped after | 2 h without an attempt | 1 h without an attempt |
| A failed refresh counts as persistent after | 3 consecutive failures | 4 consecutive failures (one bad quarter-hour is not news) |

Each health record keeps, per source: latest attempt, latest success, outcome, safe error code, consecutive failures, record counts (source rows, kept rows) and, for the daily summary, counters that are never served to the browser. `/api/fires` and `/api/incidents` each serve only their own source's public health.

## Alerts

Optional, free, and off unless configured. Telegram is the main channel; Discord works the same way and can be used instead or as well. The app runs normally with neither. Set them as Worker secrets:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN    # from @BotFather
npx wrangler secret put TELEGRAM_CHAT_ID      # numeric chat id, or @channel
npx wrangler secret put DISCORD_WEBHOOK_URL   # optional: https://discord.com/api/webhooks/<id>/<token>
```

Channels with missing or malformed secrets are skipped. The Discord URL must be an https webhook on a Discord host, so a mistyped secret cannot send data elsewhere.

### Immediate alerts

Each source has its own policy, so one outage produces at most one message per event:

| Event | FIRMS | ANEPC |
|---|---|---|
| Refresh failing | the 3rd consecutive failed run | the 4th consecutive failed run (one hour) |
| Data is stale | the last good snapshot is more than 6 h old | the last good snapshot is more than 3 h old |
| Refresh not running | no attempt recorded for 2 h | no attempt recorded for 1 h |
| Recovered | the first success after any of the above | the same |

A failure of one source never raises the other's alert, and the title names the source ("ANEPC refresh failing", "Operational data is stale"). The stall check runs before the heavy work, in case the current run is stopped too. The debounce state lives inside each health record, so alerts add no KV writes.

### Daily summary

Once a day, from 07:00 UTC, the hourly run looks at counters accumulated since the last summary and sends one message **only if something is worth reading**:

| Reported when | Example line |
|---|---|
| 2 or more failures recovered before they reached the alert threshold | `ANEPC: 3 failed attempts, 2 recovered before an alert` |
| 3 or more upstream responses slower than 20 s | `NASA FIRMS: 4 slow upstream responses (over 20 s)` |
| any records dropped as unreadable | `ANEPC: 2 records dropped as unreadable` |
| any truncated responses | `ANEPC: 1 truncated responses (records may be missing)` |
| any phase label WildfireWatch does not recognise | `ANEPC: unrecognised phase labels: Chegada ao TO` |

With nothing to report, nothing is sent. Either way the counters restart and the day is marked as summarised, so a summary is never repeated. Anything urgent has already gone out as an immediate alert and is not repeated here.

### What messages contain

Only the event, the source, times, outcome, a safe error code, consecutive failures, data age and record counts, plus, in the summary, phase labels from the public feed reduced to letters, digits and basic punctuation. Never a secret, an API key, upstream response text or anything about visitors. Delivery failures are logged by channel name and HTTP status only.

## API protection

Every route that reaches a third party quantises its input, caches results in memory per isolate, joins identical in-flight lookups and caps upstream calls per isolate (`src/lib/server/upstream-guard.ts`). Over the cap it answers `503` with `Retry-After` and the panel shows its existing "temporarily unavailable" state. Visitors are never identified: limits apply to how often an isolate calls upstream, not to who is asking.

| Route | Upstream | Input normalisation | Cache | Upstream cap per isolate |
|---|---|---|---|---|
| `/api/fires` | Workers KV | none | composed body, 60 s | about 2 KV reads/min |
| `/api/incidents` | Workers KV | none | composed body, 60 s; browser and edge `max-age=60` | about 2 KV reads/min |
| `/api/fires/detail` | NASA FIRMS area API | bbox grown to a 0.1° grid, span ≤ 5°, 1–5 days, start date validated | 30 min (12 entries) + edge cache | 20 calls/min |
| `/api/reverse-geocode` | Nominatim | coordinates rounded to 0.02° (~2 km) | 24 h (1 000 entries) + edge cache 7 days | 30/min, serialised 1 per 1.1 s, queue of 4 |
| `/api/air-quality` | OpenAQ | coordinates rounded to 0.02°; distance re-measured from the detection | 15 min (500 entries) + edge cache | 8 lookups/min (up to 7 OpenAQ calls each) |
| `/api/news` | Google News RSS, Bing RSS fallback | place names only (letters, digits, separators), ≤ 100/60 characters; case and spacing ignored | 15 min (300 entries) + edge cache | 12 lookups/min (up to 6 feed calls each) |

No user-triggered route writes to KV. The free plan allows 1 000 KV writes a day for the whole account, and the scheduled runs need about 291 of them (see below); when every distinct reverse-geocode or detail request used to write a cache entry, a crawler could exhaust the quota and freeze the map.

Error logs record error names and HTTP statuses only: a fetch error message can contain the request URL, and the FIRMS URL contains the map key.

### Optional upgrades (not enabled)

- **Workers Rate Limiting binding** (`ratelimits` in `wrangler.jsonc`, periods of 10 or 60 s). It is generally available, but its availability and cost on the Free plan could not be confirmed from the documentation, and it would key limits on visitor IPs. Test with a non-production Worker before enabling:
  ```jsonc
  "ratelimits": [{ "name": "API_RATE_LIMITER", "namespace_id": "1001", "simple": { "limit": 60, "period": 60 } }]
  ```
- **WAF rate-limiting rules** need a zone (a custom domain); they cannot be attached to a `*.workers.dev` address.

## Free-plan budget

Everything runs on the Workers Free plan. No paid feature is enabled.

| Resource (Free plan) | Limit | WildfireWatch |
|---|---|---|
| Cron Triggers | 5 per account | 2 schedules: `0 * * * *` (FIRMS, then ANEPC, then the daily summary) and `15,30,45 * * * *` (ANEPC) |
| KV writes | 1 000/day, account-wide | about **291/day** when everything succeeds: FIRMS 4 per run (snapshot, health, recurrence history, fusion index) × 24 = 96; ANEPC 2 per run (snapshot, health) × 96 = 192; daily summary 3. A failed run writes 1 (its health record), +1 when a stall alert is recorded. User routes: 0 |
| KV reads | 100 000/day | scheduled runs: about 270/day; `/api/fires` and `/api/incidents`: ≤ 2 per minute per isolate each |
| Worker requests | 100 000/day | page loads, API calls and 120 scheduled runs a day; static assets are free |
| CPU time | 10 ms per request and per cron run | see below |
| Subrequests | 50 external per invocation | top-of-hour run: 1 FIRMS + 1 ANEPC call + alert calls (at most 2 per message); quarter-hour runs: 1 ANEPC call + alerts |

**CPU.** The Free plan's documented CPU limit is 10 ms per cron run, with some per-isolate tolerance for occasional overruns. Parsing the worldwide FIRMS CSV needs far more, and that was already the case before ANEPC was added. If runs start being stopped, the panel says refreshes have stopped and the stall alert fires; the fixes are a smaller FIRMS feed (fewer days or a regional area) or the Workers Paid plan, and neither is applied today.

The ANEPC run is much lighter. Measured on synthetic data with Node 22 on the build machine (median of 7 cold runs; Workers CPU accounting differs, so these are indications, not guarantees):

| Scenario | Open rural fires / other records | Detections in mainland Portugal | Parse | Read fusion index | Reconcile | Total | Stored snapshot | `/api/incidents` (gzip) |
|---|---|---|---|---|---|---|---|---|
| Quiet day | 15 / 60 | 200 | 1.4 ms | 0.6 ms | 2.0 ms | ≈ 4 ms | 11 KiB | 1.5 KiB |
| Busy day | 120 / 150 | 2 000 | 2.8 ms | 4.0 ms | 7.8 ms | ≈ 15 ms | 89 KiB | 7.6 KiB |
| Extreme day | 300 / 200 | 8 000 | 4.7 ms | 14.2 ms | 20.6 ms | ≈ 41 ms | 274 KiB | 25.5 KiB |

Warm runs of the same code take a fraction of these times (the busy-day reconciliation takes about 2 ms warm). Before the grid index, the busy-day reconciliation alone took about 65 ms and the extreme one about 630 ms. On a busy or extreme day the quarter-hour run can still exceed 10 ms; a stopped run keeps the previous snapshot, the panel labels it as out of date after 45 minutes, and the stall alert fires after an hour. The next optimisation, once the live schema is confirmed, is the server-side filter described in [Operational source](#operational-source-anepc).

## Security headers

`src/lib/security/headers.ts` builds the Content Security Policy from the hosts the browser really contacts: this origin, CARTO (`basemaps.cartocdn.com`, `*.basemaps.cartocdn.com`), Esri (`server.arcgisonline.com`) and Open-Meteo (`api.open-meteo.com`). It also sets `frame-ancestors 'none'`, `frame-src 'none'`, `object-src 'none'`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS, COOP and CORP. `next.config.ts` applies them to Worker responses and `public/_headers` to static assets; a unit test keeps the two identical, and every end-to-end test fails on a CSP violation.

`'unsafe-inline'` remains in `script-src` because statically rendered Next.js pages inline their bootstrap and cannot carry a per-request nonce; no third-party script is loaded.

**MapLibre.** The map uses MapLibre GL JS 6, which fixes GHSA-jrc7-96c5-q579 (an XSS bypass in the sanitiser MapLibre applies to attribution and popup HTML, fixed in 6.4.1). Version 6 runs its tile worker as an ES module from this origin: `scripts/copy-maplibre-worker.mjs` copies `maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` into `public/maplibre/` before every `dev` and `build`, and `FireMap` points `setWorkerUrl` at them. The policy therefore allows workers from `'self'` only, with no `blob:` workers. The copied files are build output and are not committed.

MapLibre 6 needs WebGL2. When the browser or device cannot create a WebGL2 context, MapLibre throws a `GPUInitializationError`; the app catches it once (no retries, no console error), replaces the loading state with a notice in the map area, and hides the map-only controls (basemap switch, timeline, legend). The notice is about the map renderer, not the data: the panel, the detection list, the detection details and the legal pages keep working. `e2e/map-unavailable.spec.ts` runs Chromium with WebGL2 disabled to cover this.

**CARTO key.** CARTO requires an API key on basemap requests. The free key is configured in GitHub as `CARTO_API_KEY`; the production build passes it as `NEXT_PUBLIC_CARTO_API_KEY` and the map adds it to CARTO URLs only. The key ends up in the public JavaScript bundle and in every tile request, so it is not a secret, but it is kept out of logs where possible:

- only the deploy build on `main` receives it; pull-request builds stub CARTO and do not need it;
- the workflow prefers an Actions **secret** named `CARTO_API_KEY` and falls back to the repository **variable** of the same name. GitHub prints the values of non-secret variables in each step's environment listing, so storing the key as a secret keeps it out of the deploy log as well.

## Testing

| Command | What it covers |
|---|---|
| `npm run test:unit` | Every `*.test.ts` under `src/` and `workers/`: model, health, alerts, ingest with a fake KV, routes with stubbed upstreams, headers. `npm run test:unit -- viirs` filters by path. |
| `npm run test:static` | Source-level checks: contrast floor, icon semantics, legal links, PT-PT copy, typography, no trackers, no "severity" in the model or copy. |
| `npm run test:e2e` | Playwright against the production build (`npm run build:cloudflare` first) under `wrangler dev`. `e2e/multisource.spec.ts` covers every reconciliation case above with a synthetic ANEPC snapshot built by the app's own parser and reconciliation (`e2e/support/operational-feed.ts`); CI never contacts ANEPC or EFFIS. |
| `npm test` | Unit and static tests. |

### End-to-end (synthetic) versus live smoke

The end-to-end suite proves the app's own behaviour with deterministic synthetic snapshots in local KV and every third-party host stubbed in the browser. It cannot prove that NASA, ANEPC, CARTO, Esri, Open-Meteo, OpenAQ, Nominatim or the news feeds are reachable, that production secrets are set, or that the scheduled ingest runs. After each production deploy, check by hand:

1. The map draws the CARTO basemap (no "API key required" watermark) and, in satellite mode, Esri imagery.
2. The overview badge reads "Dados atuais" and the snapshot time is within the last hour or two.
3. `curl -sI https://wildfire-watch.duartemonteiro.workers.dev/api/fires` shows `x-wildfire-ingest-outcome: success` and a `content-security-policy` header.
4. Selecting a detection shows a place name, model weather, an air-quality reading or "no monitor", and news or "no recent coverage".
5. The browser console shows no Content Security Policy violations.
6. In the Cloudflare dashboard (Workers → wildfire-watch → Logs), the latest cron runs logged "Scheduled refresh succeeded", with `firms` on the top-of-hour run and `anepc` on every run.
7. On the same host, `/api/incidents` answers `200` with a `generatedAt` less than 20 minutes old (outside the fire season the list can be empty; that is not a failure).
8. The overview shows the "Ocorrências oficiais" card with the "Atual" badge, and a detection in mainland Portugal says whether an occurrence is nearby.
