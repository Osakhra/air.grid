# `> air.grid` — Architecture

> A *.castor subdomain at **air.andrewcastor.dev**. A live U.S. air-quality +
> industrial-emissions atlas — same "explore the data behind something that affects you"
> genre as InfraMap, different domain and a real live feed.

---

## 1. What it is

An interactive dark-basemap atlas of the U.S. showing:

- **Industrial emitters** — points sized by emissions, colored by pollutant.
- **Live air quality** — a sensor heatmap that actually updates (hourly), not a mock feed.
- **Schools & campuses** — overlay to anchor the "what's in the air near you" hook.
- **Demographics** — optional environmental-justice overlay.
- **Wind** — direction field so you can see what's drifting where.

Plus a derived `Analysis` page (the InfraMap "Grid Analysis" analogue): regional rankings,
worst-exposed campuses, pollutant breakdowns, live AQI leaderboards.

## 2. Why this shape

Three design forces:

1. **Visual parity with InfraMap.** Thousands of geolocated points + sized/colored nodes +
   toggleable layers + per-region panels + a live header. Air quality supplies all of these
   *and* a genuine real-time data stream, which a salary/jobs dataset cannot.
2. **Audience fit.** Health/climate is salient to students; the per-campus framing makes it
   personal and shareable.
3. **Clean parallel decomposition.** The build splits into independent ingestion pipelines
   (one per data source) plus a few UI/analysis modules. That independence is the *only*
   legitimate reason to run multiple agents — see §5.

## 3. Data sources

> All public. Verify current access tiers, keys, and rate limits before relying on them —
> several require a free API key and have request caps.

| Domain | Source | Notes |
|---|---|---|
| Emissions / facilities | EPA ECHO, FRS, TRI, GHGRP | Facility locations + reported emissions. Bulk + API. |
| Live air quality (official) | AirNow API | EPA AQI, hourly. Free key, rate-limited. |
| Live air quality (dense) | PurpleAir, OpenAQ | Crowdsourced + aggregated sensors for density. |
| Schools / colleges | NCES, IPEDS | Locations + enrollment. Bulk download. |
| Demographics | U.S. Census ACS API | Income, population, composition by tract. |
| Wind | NWS api.weather.gov | Wind speed/direction grid for the drift layer. |

## 4. The schema contract (single source of truth)

Every ingestion agent writes to its own slice of one normalized schema. **This file is the
coordination mechanism.** Nothing else may invent fields. Stored as
`/data/schema.contract.json` and enforced by the `schema-keeper` agent.

```
facilities[]    { id, name, lat, lng, type, operator, pollutants[], emissions_value, emissions_unit, year, source }
sensors[]       { id, lat, lng, aqi, pm25, o3, source, observed_at }
schools[]       { id, name, lat, lng, level("k12"|"college"), enrollment, source }
demographics[]  { geoid, lat, lng, population, median_income, pct_minority, source }
wind[]          { cell_id, lat, lng, speed_mps, dir_deg, observed_at }
```

Output format: newline-delimited JSON or GeoJSON FeatureCollection per table, written to
`/data/{table}.geojson`. Live tables (`sensors`, `wind`) are refreshed by a scheduled
serverless function; static tables are built once and cached.

## 5. Parallelization strategy (the part that demonstrates the skill)

Claude Code subagents run in **isolated contexts** and return only a summary to the parent.
They do **not** share memory. Therefore agents coordinate through two files on disk:

- `/data/schema.contract.json` — the data contract (read-only for everyone but schema-keeper).
- `/STATUS.md` — a queue/status board the orchestrator and agents update (TODO → IN_PROGRESS → DONE).

Build phases:

```
Phase 0  (sequential, orchestrator)   Scaffold repo + freeze schema contract.
Phase 1  (PARALLEL)                    ingest-emissions ┐
                                       ingest-airquality│  independent — run concurrently
                                       ingest-schools   │  each writes one /data/*.geojson
                                       ingest-census    ┘
Phase 2  (sequential)                  geo-matcher: proximity-join facilities↔sensors↔schools.
Phase 3  (PARALLEL)                    map-frontend ┐  touch different dirs — run concurrently
                                       analysis-dashboard ┘
Phase 4  (sequential)                  qa-integrator: contract validation, perf, e2e.
```

Phase 0 and the schema contract **must** be sequential and frozen first — it is the
dependency every parallel agent relies on. Skipping this is the #1 way multi-agent builds
collapse into agents overwriting each other.

## 6. Tech stack

- **Frontend:** Next.js on Vercel (matches InfraMap's deploy story).
- **Map:** MapLibre GL or Leaflet for the basemap + `deck.gl` for rendering thousands of
  points performantly (plain Leaflet markers will choke past ~2–3k points).
- **Live data:** Vercel scheduled function polls AirNow/PurpleAir/NWS, writes cached GeoJSON.
- **Static data / joins:** Python (pandas + shapely/geopandas) ETL for the heavy geospatial work.
- **Storage:** start with cached GeoJSON files; add Postgres/PostGIS only if query needs grow.

## 7. Risks / honest caveats

- **Data plumbing is the hard part**, not the map. Budget most of the time on Phase 1–2.
- **API limits** can throttle the live feed; cache aggressively and degrade gracefully.
- **PurpleAir data is noisy** (crowdsourced); apply EPA's correction factor or label it.
- **Don't overclaim.** Show data provenance and timestamps; this is the credibility InfraMap has.
