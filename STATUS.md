# STATUS

Shared task board. Subagents have isolated context — this file + `/data/` are the only shared
state. Read before starting, update on finish. States: TODO / IN_PROGRESS / DONE / BLOCKED.

## Phase 0 — scaffold + contract (sequential)
- [x] DONE  schema-keeper: author + freeze /data/schema.contract.json
  - output: /data/schema.contract.json (version 1.0.0, frozen 2026-06-01)
  - tables defined: facilities, sensors, schools, demographics, wind, joins/school_exposure, joins/facility_demographics
  - Phase 1 ingestion agents may now begin (parallel)

## Phase 1 — ingestion (parallel)
- [x] DONE  ingest-airquality
  - output: /data/sensors.geojson (15897 features)
  - output: /data/wind.geojson (76 features)
  - sources live at build time: airnow, purpleair-epa-corrected, openaq, nws-api-weather-gov
  - etl: /etl/ingest_airquality.py (idempotent, re-runnable)
  - cron: /app/api/refresh/route.ts (Vercel hourly, schedule "0 * * * *" in /vercel.json)
  - completed: 2026-06-01T19:24:23Z
- [x] DONE  ingest-emissions    -> /data/facilities.geojson   (count: 268,980, vintage: GHGRP-2022 + ECHO-2024)
  - output: /data/facilities.geojson (268,980 features: 11,094 GHGRP + 257,886 ECHO)
  - GHGRP: 11,094 large emitters with real CO2e emissions (metric tons/year, year 2022)
  - ECHO: 257,886 air-permitted facilities (TRI air releases lbs/year, database vintage 2024)
  - validation: 0 schema errors; all features have unique IDs, valid WGS84 coords, required fields
  - etl: /etl/ingest_emissions.py (idempotent, cache at /data/_cache/emissions/)
  - sources: EPA GHGRP efservice API + EPA ECHO air_rest_services API
  - completed: 2026-06-01T20:10:13Z
- [x] DONE  ingest-schools      -> /data/schools.geojson      (count: 108,336, vintage: nces-2022-23 + ipeds-2022-23)
  - output: /data/schools.geojson (108,336 features: 102,135 K-12 + 6,201 colleges)
  - k12 enrollment present: 99,662 / 102,135 schools
  - college enrollment present: 6,000 / 6,201 institutions
  - etl: /etl/ingest_schools.py (idempotent, re-runnable)
  - sources: NCES EDGE Geocode 2022-23, NCES CCD Membership 2022-23, IPEDS HD2022, IPEDS EFFY2022
  - completed: 2026-06-01T19:22:41Z
- [x] DONE  ingest-census       -> /data/demographics.geojson (count: 84539, vintage: ACS 5-Year 2022)

## Phase 2 — joins (sequential, needs all of Phase 1)
- [x] DONE  geo-matcher         -> /data/joins/* (radius: 10km facilities / 50km sensors, N: 5)
  - output: /data/joins/school_exposure.geojson (108,336 features, 57.3 MB)
  - output: /data/joins/facility_demographics.geojson (268,980 features, 85.3 MB)
  - etl (school_exposure): /etl/geo_matcher.py (idempotent, re-runnable)
  - etl (facility_demographics): /etl/geo_matcher_facility_demo.py (idempotent, re-runnable)
  - parameters (school_exposure): FACILITY_RADIUS_M=10000, FACILITY_TOP_N=5, SENSOR_RADIUS_M=50000
  - parameters (facility_demographics): NEAREST_K=1 (nearest-centroid join, no radius filter)
  - method: scipy.spatial.cKDTree on scaled-radian Euclidean approximation (lng * cos(mean_lat))
  - school_exposure stats: 102,813 schools have >=1 nearby facility; 760 have live AQI; 61,103 flagged downwind
  - facility_demographics stats: 268,980 facilities joined to nearest Census tract; 2,309 with null median_income (Census-suppressed); 266,671 have median_income; 0 schema errors
  - validation: 0 schema errors on both outputs
  - completed: 2026-06-01

## Phase 3 — UI (parallel)
- [x] DONE  map-frontend        -> /app map routes
  - route: / (app/page.tsx — full-viewport MapLibre dark basemap + deck.gl overlay)
  - api routes (all under /api/map/):
    - GET /api/map/facilities    — top 10,000 facilities by emissions_value desc (sampled from 268,980)
    - GET /api/map/sensors       — all 15,897 sensors, 5-min cache (sensor polling)
    - GET /api/map/schools       — top 20,000 schools by enrollment desc (sampled from 108,336)
    - GET /api/map/wind          — all 76 NWS wind points, 5-min cache
    - GET /api/map/demographics  — 15,000-pt stride sample of 84,539 census tracts
  - components: /app/components/map/{DeckMap,MapLoader,MapTooltip,LayerPanel,LiveHeader,types,colors}.tsx/ts
  - basemap: CARTO dark-matter-gl-style via react-map-gl/maplibre + NavigationControl
  - layers: Facilities ScatterplotLayer (log-scaled radius 3–20px, 5-pollutant RGBA palette)
  - layers: Sensors HeatmapLayer (AQI-weighted) + invisible ScatterplotLayer for hover picking
  - layers: Schools ScatterplotLayer (teal=K-12, purple=college)
  - layers: Wind ScatterplotLayer dots at NWS stations (disabled on mobile <768px)
  - layers: Demographics ScatterplotLayer (teal→gold by pct_minority)
  - chrome: LiveHeader (pulsing .live-dot, observed_at, active sensor count, refresh age)
  - chrome: LayerPanel (bottom-left panel, per-layer ON/OFF toggles, AQI + pollutant mini-legends)
  - chrome: MapTooltip (viewport-clamped floating card, all source provenance fields)
  - sensor layer polls /api/map/sensors every 5 min for live-data effect
  - mobile: wind disabled, point density capped (radiusMinPixels reduced)
  - data assumption: facilities sorted by emissions_value; ECHO records may have emissions_value=0 (no TRI release) — top-N filter keeps the meaningful GHGRP + large ECHO emitters
  - data assumption: sensors observed_at reflects last reading from AirNow/PurpleAir/OpenAQ; may be up to 1h stale at page load; 5-min polling picks up /api/refresh updates
  - build verified: next build clean, 0 TypeScript errors, / = 1.35 kB first-load JS (DeckMap lazy)
  - completed: 2026-06-01
- [x] DONE  analysis-dashboard  -> /app analysis routes
  - route: /analysis (app/analysis/page.tsx — Next.js Server Component, revalidate 3600s)
  - api routes (all under /api/analysis/):
    - GET /api/analysis/summary          — headline counts + avg/max AQI + freshness timestamps
    - GET /api/analysis/aqi-leaderboard  — top 20 sensors by AQI desc, with stale detection
    - GET /api/analysis/top-polluters    — top 20 facilities by emissions_value desc
    - GET /api/analysis/pollutant-breakdown — top 10 pollutant categories by total emissions
    - GET /api/analysis/most-exposed-schools — top 20 schools by max_emissions_nearby (joined with enrollment/level)
    - GET /api/analysis/ej-hotspots      — top 20 facilities in majority-minority tracts (pct_minority > 0.6)
    - GET /api/analysis/regional-breakdown — total emissions + facility count by US region
  - shared loader: /app/lib/dataLoader.ts (module-level cache; all routes use it; map routes may adopt)
  - components: /app/components/analysis/{AqiLeaderboard,TopPolluters,PollutantChart,MostExposedSchools,EjHotspots,RegionalChart,StatCard,aqiUtils}.tsx
  - charts: Recharts BarChart (pollutant mix + regional, horizontal), tables sortable client-side
  - stale detection: flags sensor data >2 h old with STALE badge + warn color on every live figure
  - provenance: every section shows source strings and timestamps
  - build verified: `next build` clean, 18 routes, /analysis = 102 kB first-load JS
  - completed: 2026-06-01

## Phase 4 — gate (sequential, last)
- [ ] TODO  qa-integrator       -> /docs/QA_REPORT.md

## Schema change requests
(ingestion agents log field requests here for schema-keeper)

## Blockers
(log dead APIs, missing keys, rate-limit issues here)


