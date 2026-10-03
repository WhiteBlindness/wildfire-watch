# Operations

How WildfireWatch gets its data, how it knows when that data is wrong, and how it stays inside Cloudflare's free plan. For the legal and third-party side, see [compliance.md](./compliance.md).

## Data flow

```
                 hourly cron (workers/app-entry.ts)
NASA FIRMS ──CSV──→ refreshFirmsCache ──→ KV  active-fires:v1                (snapshot, last known good)
 (world, 3 days)      │                   KV  active-fires:ingest-health:v1  (health + alert state)
                      └─→ Discord / Telegram (optional, on failure and recovery)

browser ──→ /api/fires ──→ snapshot + public health ──→ adapter ──→ ThermalDetection[] + provenance + health ──→ map / panel
```

A page load never waits on NASA. The snapshot is replaced only by a complete worldwide feed (at least 5 000 points across 8 longitude and 4 latitude bands); anything else is recorded as a failure and the previous snapshot stays.

## Domain model

`src/lib/wildfire/types.ts` keeps three kinds of information apart:

| Kind | Example | Who can provide it |
|---|---|---|
| Observation | A `ThermalDetection`: pixel centre, acquisition time, FRP, the source's confidence category, pixel size | An instrument or authority (today: FIRMS VIIRS) |
| Derived value | FRP intensity band (map colour), country from coordinates, burned-area estimate | WildfireWatch, labelled *estimated* or *inferred* |
| Operational status | `unknown`, `active`, `contained`, `extinguished` | Only an operational source; satellite data is always `unknown` |

Provenance is shared, not repeated per point: each detection references a `DatasetId`, and the snapshot carries one `SnapshotProvenance` (provider, product, instrument, attribution, source URL, retrieval and processing times, row counts). The detail panel shows it with the acquisition window of the selection.

## Feed health

Two independent questions, combined only for display (`src/lib/wildfire/feed-health.ts`):

- **Snapshot freshness**: is the data shown older than 90 minutes?
- **Ingest health**: did the latest scheduled refresh work? The KV record counts consecutive failures and keeps the last success time.

| Panel state | When |
|---|---|
| Current data | Fresh snapshot, latest refresh succeeded (or no failure is known) |
| Refresh failing | Fresh snapshot, but the latest refresh failed: "showing the last successful snapshot, from 13:00" |
| Out-of-date data | Snapshot older than 90 minutes, whatever the refresh says; the message adds whether refreshes are failing or have stopped |
| Source unavailable | No usable snapshot |

The ingest is *stalled* when no attempt has been recorded for two hours (for example, runs stopped by a platform limit before they could write). A failure recorded before the current snapshot was built is treated as superseded. Malformed or missing health records degrade to "status unknown"; they never hide the snapshot.

## Alerts

Optional, free, and off unless configured. Set any of these as Worker secrets:

```bash
npx wrangler secret put DISCORD_WEBHOOK_URL   # https://discord.com/api/webhooks/<id>/<token>
npx wrangler secret put TELEGRAM_BOT_TOKEN    # from @BotFather
npx wrangler secret put TELEGRAM_CHAT_ID      # numeric chat id, or @channel
```

Channels with missing or malformed secrets are skipped. The Discord URL must be an https webhook on a Discord host, so a mistyped secret cannot send data elsewhere.

One outage produces at most:

| Event | Sent when |
|---|---|
| FIRMS refresh failing | The third consecutive failed run |
| Map data is stale | The last good data is more than 6 hours old |
| FIRMS refresh not running | A run finds no attempt recorded for 2 hours (checked before the heavy work, in case this run is stopped too) |
| FIRMS refresh recovered | The first success after any of the above |

The debounce state lives inside the health record, so alerts add no KV writes. Messages contain only the event, times, outcome, error code, consecutive failures, data age, source rows and selected points. They never contain the map key, upstream response text or anything about visitors. Delivery failures are logged by channel name and HTTP status only.

## API protection

Every route that reaches a third party quantises its input, caches results in memory per isolate, joins identical in-flight lookups and caps upstream calls per isolate (`src/lib/server/upstream-guard.ts`). Over the cap it answers `503` with `Retry-After` and the panel shows its existing "temporarily unavailable" state. Visitors are never identified: limits apply to how often an isolate calls upstream, not to who is asking.

| Route | Upstream | Input normalisation | Cache | Upstream cap per isolate |
|---|---|---|---|---|
| `/api/fires` | Workers KV | none | composed body, 60 s | about 2 KV reads/min |
| `/api/fires/detail` | NASA FIRMS area API | bbox grown to a 0.1° grid, span ≤ 5°, 1–5 days, start date validated | 30 min (12 entries) + edge cache | 20 calls/min |
| `/api/reverse-geocode` | Nominatim | coordinates rounded to 0.02° (~2 km) | 24 h (1 000 entries) + edge cache 7 days | 30/min, serialised 1 per 1.1 s, queue of 4 |
| `/api/air-quality` | OpenAQ | coordinates rounded to 0.02°; distance re-measured from the detection | 15 min (500 entries) + edge cache | 8 lookups/min (up to 7 OpenAQ calls each) |
| `/api/news` | Google News RSS, Bing RSS fallback | place names only (letters, digits, separators), ≤ 100/60 characters; case and spacing ignored | 15 min (300 entries) + edge cache | 12 lookups/min (up to 6 feed calls each) |

No user-triggered route writes to KV. The free plan allows 1 000 KV writes a day for the whole account, and the hourly ingest needs about 72 of them; when every distinct reverse-geocode or detail request used to write a cache entry, a crawler could exhaust the quota and freeze the map.

Error logs record error names and HTTP statuses only: a fetch error message can contain the request URL, and the FIRMS URL contains the map key.

### Optional upgrades (not enabled)

- **Workers Rate Limiting binding** (`ratelimits` in `wrangler.jsonc`, periods of 10 or 60 s). It is generally available, but its availability and cost on the Free plan could not be confirmed from the documentation, and it would key limits on visitor IPs. Test with a non-production Worker before enabling:
  ```jsonc
  "ratelimits": [{ "name": "API_RATE_LIMITER", "namespace_id": "1001", "simple": { "limit": 60, "period": 60 } }]
  ```
- **WAF rate-limiting rules** need a zone (a custom domain); they cannot be attached to a `*.workers.dev` address.

## Free-plan budget

| Resource (Free plan) | Limit | WildfireWatch |
|---|---|---|
| KV writes | 1 000/day, account-wide | ingest: 3 per successful run, 1 per failed run, +1 when a stall alert is recorded (≤ 96/day); user routes: 0 |
| KV reads | 100 000/day | ingest: 2 per run; `/api/fires`: ≤ 2 per minute per isolate |
| Worker requests | 100 000/day | page loads, API calls; static assets are free |
| CPU time | 10 ms per request and per cron run | see limitation below |
| Subrequests | 50 external per invocation | ingest: 1 FIRMS call + up to 2 alert calls |

**Limitation to watch:** the Free plan's documented CPU limit for a cron run is 10 ms, and parsing the worldwide CSV needs far more. If runs start being stopped, the panel will say refreshes have stopped and the stall alert will fire. The fixes are a smaller feed (fewer days or a regional area) or the Workers Paid plan; neither is applied today.

## Security headers

`src/lib/security/headers.ts` builds the Content Security Policy from the hosts the browser really contacts: this origin, CARTO (`basemaps.cartocdn.com`, `*.basemaps.cartocdn.com`), Esri (`server.arcgisonline.com`) and Open-Meteo (`api.open-meteo.com`). It also sets `frame-ancestors 'none'`, `frame-src 'none'`, `object-src 'none'`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS, COOP and CORP. `next.config.ts` applies them to Worker responses and `public/_headers` to static assets; a unit test keeps the two identical, and every end-to-end test fails on a CSP violation.

`'unsafe-inline'` remains in `script-src` because statically rendered Next.js pages inline their bootstrap and cannot carry a per-request nonce; no third-party script is loaded.

**MapLibre.** The map uses MapLibre GL JS 6, which fixes GHSA-jrc7-96c5-q579 (an XSS bypass in the sanitiser MapLibre applies to attribution and popup HTML, fixed in 6.4.1). Version 6 runs its tile worker as an ES module from this origin: `scripts/copy-maplibre-worker.mjs` copies `maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` into `public/maplibre/` before every `dev` and `build`, and `FireMap` points `setWorkerUrl` at them. The policy therefore allows workers from `'self'` only, with no `blob:` workers. The copied files are build output and are not committed.

MapLibre 6 needs WebGL2. In a browser without it the map cannot start: the panel, the detection list and the detection details still work, but the map area keeps its loading state.

**CARTO key.** CARTO requires an API key on basemap requests. The free key is configured in GitHub as `CARTO_API_KEY`; the production build passes it as `NEXT_PUBLIC_CARTO_API_KEY` and the map adds it to CARTO URLs only. The key ends up in the public JavaScript bundle and in every tile request, so it is not a secret, but it is kept out of logs where possible:

- only the deploy build on `main` receives it; pull-request builds stub CARTO and do not need it;
- the workflow prefers an Actions **secret** named `CARTO_API_KEY` and falls back to the repository **variable** of the same name. GitHub prints the values of non-secret variables in each step's environment listing, so storing the key as a secret keeps it out of the deploy log as well.

## Testing

| Command | What it covers |
|---|---|
| `npm run test:unit` | Every `*.test.ts` under `src/` and `workers/`: model, health, alerts, ingest with a fake KV, routes with stubbed upstreams, headers. `npm run test:unit -- viirs` filters by path. |
| `npm run test:static` | Source-level checks: contrast floor, icon semantics, legal links, PT-PT copy, typography, no trackers, no "severity" in the model or copy. |
| `npm run test:e2e` | Playwright against the production build (`npm run build:cloudflare` first) under `wrangler dev`. |
| `npm test` | Unit and static tests. |

### End-to-end (synthetic) versus live smoke

The end-to-end suite proves the app's own behaviour with a deterministic synthetic snapshot in local KV and every third-party host stubbed in the browser. It cannot prove that NASA, CARTO, Esri, Open-Meteo, OpenAQ, Nominatim or the news feeds are reachable, that production secrets are set, or that the scheduled ingest runs. After each production deploy, check by hand:

1. The map draws the CARTO basemap (no "API key required" watermark) and, in satellite mode, Esri imagery.
2. The overview badge reads "Dados atuais" and the snapshot time is within the last hour or two.
3. `curl -sI https://wildfire-watch.duartemonteiro.workers.dev/api/fires` shows `x-wildfire-ingest-outcome: success` and a `content-security-policy` header.
4. Selecting a detection shows a place name, model weather, an air-quality reading or "no monitor", and news or "no recent coverage".
5. The browser console shows no Content Security Policy violations.
6. In the Cloudflare dashboard (Workers → wildfire-watch → Logs), the latest cron run logged "FIRMS scheduled refresh succeeded".
