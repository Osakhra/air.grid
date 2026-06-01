# CLAUDE.md

Project context for Claude Code. This file is read automatically at session start.

## Project

air.grid — a live U.S. air-quality + industrial-emissions atlas. Interactive dark-basemap
map (MapLibre/Leaflet + deck.gl) with toggleable layers, a live sensor feed, and a derived
analysis dashboard. Deployed on Vercel. See `ARCHITECTURE.md` for the full design.

## Non-negotiable rules

1. **The schema contract is law.** `/data/schema.contract.json` defines every field of every
   table. Do not add, rename, or repurpose fields without updating the contract first, and
   only the `schema-keeper` agent may edit the contract. All ingestion output must validate
   against it.
2. **Coordinate through files, not assumptions.** Subagents have isolated context. The only
   shared state is `/data/*` and `/STATUS.md`. Read `/STATUS.md` before starting work and
   update it when you finish (TODO → IN_PROGRESS → DONE, with the output path).
3. **One agent owns one slice.** Ingestion agents write only their own `/data/{table}.geojson`.
   Never write another table's file.
4. **No mock data in committed output.** If a live source is unreachable, fail loudly and log
   it — do not fabricate readings. Real provenance is the whole point of this project.
5. **Cite data provenance.** Every record carries a `source` field; the UI surfaces it.

## Repo layout

```
/data/                  schema.contract.json + generated *.geojson (the shared bus)
/etl/                   Python ingestion + geospatial join scripts
/app/                   Next.js frontend (map + analysis pages)
/.claude/agents/        subagent definitions
/docs/ORCHESTRATION.md  build log + agent dependency graph (recruiter-facing)
/STATUS.md              live task board
```

## Build order (do not parallelize Phase 0 or 2)

- Phase 0: scaffold + freeze schema (orchestrator only).
- Phase 1: ingestion agents — **parallel**.
- Phase 2: geo-matcher — sequential, depends on all of Phase 1.
- Phase 3: map-frontend + analysis-dashboard — **parallel**.
- Phase 4: qa-integrator — sequential, last.

## Conventions

- Python: `ruff` + type hints; ETL scripts are idempotent and re-runnable.
- TS/React: functional components, no global mutable state, layers are independent toggles.
- Commits: prefix with the agent/phase, e.g. `ingest-airquality: initial AirNow puller`.
  This keeps the multi-agent contribution visible in git history.
- Performance budget: map renders 10k+ points at 60fps via deck.gl; do not use per-marker DOM.

## Models (cost-aware routing)

- Orchestration / synthesis: Opus.
- Implementation agents (ingestion, geo, frontend, analysis): Sonnet.
- Pure lookups / file discovery: Haiku.
