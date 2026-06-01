"""
ingest_emissions.py -- EPA industrial facility emissions ingestion for air.grid
=============================================================================
Sources:
  1. EPA GHGRP (Greenhouse Gas Reporting Program) -- primary source
     API: https://enviro.epa.gov/enviro/efservice/ + https://data.epa.gov/efservice/
     Coverage: ~11,000 large emitters (>25,000 metric tons CO2e/year) with real
               emissions values, lat/lng, parent company, NAICS codes.
     Vintage: 2022 reporting year (latest stable release).
  2. EPA ECHO Air Facility Search -- supplemental source for smaller facilities
     API: https://echodata.epa.gov/echo/air_rest_services.*
     Coverage: ~280,000 air-permitted facilities; we pull those with valid lat/lng.
     Rate-limited: conservative delays between state queries.

Output: /data/facilities.geojson -- GeoJSON FeatureCollection conforming to
        /data/schema.contract.json v1.0.0

This script is idempotent: re-running overwrites /data/facilities.geojson.
The cache at /data/_cache/emissions/ is used to avoid re-downloading on re-runs.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
OUTPUT_FILE = DATA_DIR / "facilities.geojson"
CACHE_DIR = DATA_DIR / "_cache" / "emissions"

# ---------------------------------------------------------------------------
# Logging (ASCII-safe format for Windows console compatibility)
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
    encoding="utf-8",
)
log = logging.getLogger("ingest_emissions")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
USER_AGENT = "air.grid-ingest/1.0 (evyosakhra@gmail.com; github.com/air-grid)"
GHGRP_YEAR = 2022
SOURCE_TAG_GHGRP = f"EPA-GHGRP-{GHGRP_YEAR}"
SOURCE_TAG_ECHO = "EPA-ECHO-2024"

BUILD_TIMESTAMP = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# US bounding box (includes AK, HI, PR, territories)
LAT_MIN, LAT_MAX = 17.0, 72.0
LNG_MIN, LNG_MAX = -180.0, -65.0

# GHGRP sector_id -> human-readable industry type
SECTOR_NAMES: dict[int, str] = {
    2: "Waste",
    3: "Power Plants",
    4: "Refineries",
    5: "Chemicals",
    6: "Metals",
    7: "Pulp and Paper",
    8: "Minerals",
    9: "Coal-based Liquid Fuel Supply",
    10: "Petroleum Product Suppliers",
    11: "Natural Gas and Natural Gas Liquids Systems",
    12: "Industrial Gas Suppliers",
    13: "Suppliers of CO2",
    14: "Other",
    15: "Petroleum and Natural Gas Systems",
    16: "Fluorinated GHG Equipment",
    17: "Injection of CO2",
}

# GHGRP gas_id -> pollutant name
GAS_NAMES: dict[int, str] = {
    1: "CO2",
    2: "CH4",
    3: "N2O",
    6: "SF6",
    7: "HFC-23",
    8: "Biogenic CO2",
    9: "NF3",
    10: "HFCs",
    11: "PFCs",
    12: "HFEs",
}

US_STATES = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]

# ECHO columns: 1=AIR_NAME, 2=SOURCE_ID, 5=AIR_STATE, 8=REGISTRY_ID,
#               22=AIR_NAICS, 23=FAC_LAT, 24=FAC_LONG, 71=FAC_TRI_AIR_RELEASES,
#               102=AIR_FACILITY_TYPE_CODE, 132=AIR_FACILITY_TYPE_DESC
ECHO_QCOLUMNS = "1,2,5,8,22,23,24,71,102,132"

ECHO_MIN_DELAY = 5.0  # seconds between ECHO state queries (conservative)


# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------
def _fetch(url: str, retries: int = 5, timeout: int = 90) -> bytes:
    """Fetch a URL with exponential backoff on 429/5xx errors."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    backoff = 8
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            last_exc = exc
            if exc.code == 429:
                wait = backoff * (2 ** attempt)
                log.warning("Rate limited (429). Waiting %ds before retry %d/%d", wait, attempt + 1, retries)
                time.sleep(wait)
            elif exc.code >= 500:
                wait = backoff * (2 ** attempt)
                log.warning("Server error %d. Waiting %ds before retry %d/%d", exc.code, wait, attempt + 1, retries)
                time.sleep(wait)
            else:
                raise
        except Exception as exc:
            last_exc = exc
            wait = backoff * (2 ** attempt)
            log.warning("Network error: %s. Waiting %ds before retry %d/%d", exc, wait, attempt + 1, retries)
            time.sleep(wait)
    raise RuntimeError(f"All {retries} retries failed for {url}: {last_exc}")


def _fetch_json(url: str, retries: int = 5, timeout: int = 90) -> object:
    """Fetch and parse JSON from url."""
    raw = _fetch(url, retries=retries, timeout=timeout)
    return json.loads(raw.decode("utf-8", errors="replace"))


# ---------------------------------------------------------------------------
# Cache helpers (so re-runs don't re-fetch)
# ---------------------------------------------------------------------------
def _cache_path(key: str, suffix: str = ".json") -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    # Sanitize key for filesystem
    safe = (
        key.replace("/", "_")
        .replace(":", "_")
        .replace("?", "_")
        .replace("&", "_")
        .replace("=", "-")
    )
    return CACHE_DIR / f"{safe}{suffix}"


def _read_cache(key: str, suffix: str = ".json") -> bytes | None:
    p = _cache_path(key, suffix)
    if p.exists():
        return p.read_bytes()
    return None


def _write_cache(key: str, data: bytes, suffix: str = ".json") -> None:
    p = _cache_path(key, suffix)
    p.write_bytes(data)


def _fetch_cached(url: str, cache_key: str, suffix: str = ".json", **kw) -> bytes:
    """Fetch with filesystem cache for idempotency."""
    cached = _read_cache(cache_key, suffix)
    if cached is not None:
        log.debug("Cache hit: %s", cache_key)
        return cached
    data = _fetch(url, **kw)
    _write_cache(cache_key, data, suffix)
    return data


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------
def _valid_coords(lat: float | None, lng: float | None) -> bool:
    if lat is None or lng is None:
        return False
    try:
        lat_f, lng_f = float(lat), float(lng)
    except (TypeError, ValueError):
        return False
    return LAT_MIN <= lat_f <= LAT_MAX and LNG_MIN <= lng_f <= LNG_MAX


# ---------------------------------------------------------------------------
# Phase 1: GHGRP data ingestion
# ---------------------------------------------------------------------------
def _ghgrp_fetch_all_facilities() -> list[dict]:
    """
    Fetch all GHGRP facilities for GHGRP_YEAR in paginated batches.

    The enviro.epa.gov efservice API uses ROWS/{start}:{end} where
    end is EXCLUSIVE (i.e. ROWS/0:2000 returns records 0-1999 inclusive, up to
    2000 records). Cache keys use the format ghgrp_facilities_{year}_{start}_{end}
    to match pre-existing cache files.
    """
    page_size = 2000
    all_facilities: list[dict] = []
    offset = 0

    # Get total count first
    count_url = (
        f"https://enviro.epa.gov/enviro/efservice/PUB_DIM_FACILITY"
        f"/year/=/{GHGRP_YEAR}/COUNT/JSON"
    )
    count_data = _fetch_json(count_url)
    total = int(count_data[0]["TOTALQUERYRESULTS"])
    log.info("GHGRP %d: total facilities = %d", GHGRP_YEAR, total)

    while offset < total:
        end = offset + page_size
        cache_key = f"ghgrp_facilities_{GHGRP_YEAR}_{offset}_{end}"
        url = (
            f"https://enviro.epa.gov/enviro/efservice/PUB_DIM_FACILITY"
            f"/year/=/{GHGRP_YEAR}/ROWS/{offset}:{end}/JSON"
        )
        try:
            raw = _fetch_cached(url, cache_key, suffix=".json", timeout=120)
            batch = json.loads(raw.decode("utf-8", errors="replace"))
        except Exception as exc:
            log.warning("GHGRP facilities batch %d-%d failed: %s. Skipping.", offset, end, exc)
            offset += page_size
            time.sleep(5)
            continue

        if not batch:
            log.info("  GHGRP facilities: empty batch at offset %d -- done", offset)
            break

        all_facilities.extend(batch)
        log.info("  GHGRP facilities: fetched %d / ~%d (batch size: %d)", len(all_facilities), total, len(batch))
        offset += page_size
        time.sleep(1.5)

    return all_facilities


def _ghgrp_fetch_all_emissions() -> dict[int, dict]:
    """
    Fetch all GHGRP emission records for GHGRP_YEAR.
    Returns a dict: facility_id -> {
        total_co2e: float,
        gases: list[int],
        sector_ids: list[int],
    }
    """
    page_size = 5000
    offset = 0

    # Get total count
    count_url = (
        f"https://data.epa.gov/efservice/pub_facts_sector_ghg_emission"
        f"/year/=/{GHGRP_YEAR}/COUNT/JSON"
    )
    count_data = _fetch_json(count_url)
    total = int(count_data[0]["TOTALQUERYRESULTS"])
    log.info("GHGRP %d: total emission records = %d", GHGRP_YEAR, total)

    emissions: dict[int, dict] = defaultdict(lambda: {
        "total_co2e": 0.0,
        "gases": set(),
        "sector_ids": set(),
    })

    while offset < total:
        end = offset + page_size
        cache_key = f"ghgrp_emissions_{GHGRP_YEAR}_{offset}_{end}"
        url = (
            f"https://data.epa.gov/efservice/pub_facts_sector_ghg_emission"
            f"/year/=/{GHGRP_YEAR}/ROWS/{offset}:{end}/JSON"
        )
        try:
            raw = _fetch_cached(url, cache_key, suffix=".json", timeout=180)
            batch = json.loads(raw.decode("utf-8", errors="replace"))
        except Exception as exc:
            log.warning("GHGRP emissions batch %d-%d failed: %s. Skipping.", offset, end, exc)
            offset += page_size
            time.sleep(5)
            continue

        if not batch:
            log.info("  GHGRP emissions: empty batch at offset %d -- done", offset)
            break

        for rec in batch:
            fid = rec["facility_id"]
            co2e = rec.get("co2e_emission") or 0.0
            emissions[fid]["total_co2e"] += float(co2e)
            gas_id = rec.get("gas_id")
            if gas_id:
                emissions[fid]["gases"].add(gas_id)
            sector_id = rec.get("sector_id")
            if sector_id:
                emissions[fid]["sector_ids"].add(sector_id)

        log.info("  GHGRP emissions: processed records %d-%d / %d", offset, end, total)
        offset += page_size
        time.sleep(1.5)

    # Convert sets to sorted lists for JSON serializability
    for fid in emissions:
        emissions[fid]["gases"] = sorted(emissions[fid]["gases"])
        emissions[fid]["sector_ids"] = sorted(emissions[fid]["sector_ids"])

    return dict(emissions)


def _build_ghgrp_features(
    facilities: list[dict],
    emissions: dict[int, dict],
) -> list[dict]:
    """Convert GHGRP facility + emissions dicts into GeoJSON features."""
    features: list[dict] = []
    skipped_coords = 0
    skipped_no_emissions = 0

    for fac in facilities:
        lat = fac.get("latitude")
        lng = fac.get("longitude")
        if not _valid_coords(lat, lng):
            skipped_coords += 1
            continue

        fid = fac["facility_id"]
        emis = emissions.get(fid)
        if not emis:
            skipped_no_emissions += 1
            continue

        lat_f = float(lat)
        lng_f = float(lng)

        # Derive industry type from sector_ids
        sector_ids: list[int] = emis["sector_ids"]
        if sector_ids:
            sector_name = SECTOR_NAMES.get(sector_ids[0], f"Sector-{sector_ids[0]}")
        else:
            naics = fac.get("naics_code", "")
            sector_name = f"NAICS-{naics}" if naics else "Industrial"

        # Build pollutant list
        gas_ids: list[int] = emis["gases"]
        if gas_ids:
            pollutants = [GAS_NAMES.get(g, f"GHG-{g}") for g in gas_ids]
        else:
            pollutants = ["CO2"]  # fallback -- all GHGRP reporters emit CO2

        # Parent company / operator
        operator = fac.get("parent_company") or None
        # Trim to 200 chars to avoid bloat
        if operator and len(operator) > 200:
            operator = operator[:197] + "..."

        frs_id = fac.get("frs_id") or fac.get("program_sys_id") or str(fid)
        feature_id = f"ghgrp-{fid}"

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [lng_f, lat_f],
            },
            "properties": {
                "id": feature_id,
                "name": (fac.get("facility_name") or "").strip() or f"Facility-{fid}",
                "lat": lat_f,
                "lng": lng_f,
                "type": sector_name,
                "operator": operator,
                "pollutants": pollutants,
                "emissions_value": round(emis["total_co2e"], 3),
                "emissions_unit": "metric tons CO2e/year",
                "year": GHGRP_YEAR,
                "source": SOURCE_TAG_GHGRP,
                "_build_ts": BUILD_TIMESTAMP,
                "_frs_id": frs_id,
            },
        }
        features.append(feature)

    log.info(
        "GHGRP: built %d features (skipped: %d no-coords, %d no-emissions)",
        len(features), skipped_coords, skipped_no_emissions,
    )
    return features


# ---------------------------------------------------------------------------
# Phase 2: ECHO supplemental ingestion
# ---------------------------------------------------------------------------
def _echo_fetch_state(state: str) -> list[dict]:
    """
    Fetch ECHO air facilities for a single state.
    Two-step: get_facilities (returns QueryID) -> get_download (returns all rows as CSV).
    Returns a list of row dicts.
    """
    # Step 1: get query ID
    step1_url = (
        f"https://echodata.epa.gov/echo/air_rest_services.get_facilities"
        f"?output=JSON&p_st={state}&p_rows=1"
    )
    cache_key_qid = f"echo_qid_{state}"
    try:
        raw_qid = _fetch_cached(step1_url, cache_key_qid, suffix=".json", timeout=60)
        qid_data = json.loads(raw_qid.decode("utf-8", errors="replace"))
    except Exception as exc:
        log.warning("ECHO %s: get_facilities failed: %s", state, exc)
        return []

    results = qid_data.get("Results", {})
    if "Error" in results:
        log.warning("ECHO %s: API error: %s", state, results["Error"])
        return []

    qid = results.get("QueryID")
    row_count = results.get("QueryRows", "?")
    if not qid:
        log.warning("ECHO %s: no QueryID returned", state)
        return []

    log.info("  ECHO %s: %s rows, QueryID=%s", state, row_count, qid)

    # Step 2: download CSV for this query
    dl_url = (
        f"https://echodata.epa.gov/echo/air_rest_services.get_download"
        f"?output=CSV&qid={qid}&qcolumns={ECHO_QCOLUMNS}"
    )
    cache_key_csv = f"echo_csv_{state}_{qid}"
    try:
        time.sleep(2.0)  # small delay before download
        raw_csv = _fetch_cached(dl_url, cache_key_csv, suffix=".csv", timeout=120)
    except Exception as exc:
        log.warning("ECHO %s: get_download failed: %s", state, exc)
        return []

    # Parse CSV
    text = raw_csv.decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    return rows


def _build_echo_features(
    state_rows: list[dict],
    state: str,
    existing_frs_ids: set[str],
) -> list[dict]:
    """
    Convert ECHO CSV rows to GeoJSON features, skipping facilities already
    covered by GHGRP (matched on FRS Registry ID).
    """
    features: list[dict] = []
    skipped_dup = 0
    skipped_coords = 0
    skipped_no_lat = 0

    for row in state_rows:
        # Field names from ECHO CSV header
        name = (row.get("AIRName") or "").strip()
        source_id = (row.get("SourceID") or "").strip()
        registry_id = (row.get("RegistryID") or "").strip()
        naics = (row.get("AIRNAICS") or "").strip()
        lat_s = (row.get("FacLat") or "").strip()
        lng_s = (row.get("FacLong") or "").strip()
        tri_releases_s = (row.get("FacTRIAIRReleases") or "").strip()
        fac_type_desc = (row.get("AIRFacilityTypeDesc") or "").strip()

        # Check for lat/lng
        if not lat_s or not lng_s:
            skipped_no_lat += 1
            continue
        try:
            lat_f = float(lat_s)
            lng_f = float(lng_s)
        except ValueError:
            skipped_coords += 1
            continue

        if not _valid_coords(lat_f, lng_f):
            skipped_coords += 1
            continue

        # Dedup against GHGRP by FRS Registry ID
        if registry_id and registry_id in existing_frs_ids:
            skipped_dup += 1
            continue

        # Parse TRI air releases (lbs/year)
        try:
            tri_val = float(tri_releases_s) if tri_releases_s else 0.0
        except ValueError:
            tri_val = 0.0

        # Build industry type
        if fac_type_desc:
            industry_type = fac_type_desc
        elif naics:
            industry_type = f"NAICS-{naics}"
        else:
            industry_type = "Air-Permitted Facility"

        # Pollutants: ECHO facility search doesn't provide chemical breakdown
        pollutants = ["multiple"]

        feature_id = f"echo-{registry_id}" if registry_id else f"echo-{source_id}"

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [lng_f, lat_f],
            },
            "properties": {
                "id": feature_id,
                "name": name or f"Facility-{source_id}",
                "lat": lat_f,
                "lng": lng_f,
                "type": industry_type,
                "operator": None,
                "pollutants": pollutants,
                "emissions_value": tri_val,
                "emissions_unit": "lbs/year",
                "year": 2024,  # ECHO database vintage
                "source": SOURCE_TAG_ECHO,
                "_build_ts": BUILD_TIMESTAMP,
                "_frs_id": registry_id,
            },
        }
        features.append(feature)

    log.info(
        "  ECHO %s: %d rows -> %d new features (dup=%d, no-coord=%d)",
        state, len(state_rows), len(features), skipped_dup, skipped_coords + skipped_no_lat,
    )
    return features


# ---------------------------------------------------------------------------
# Phase 3: Deduplication + final assembly
# ---------------------------------------------------------------------------
def _dedupe_features(features: list[dict]) -> list[dict]:
    """
    Dedup by `id` field (first-seen wins -- GHGRP takes precedence since
    it is processed first and has richer data).
    """
    seen: dict[str, dict] = {}
    for f in features:
        fid = f["properties"]["id"]
        if fid not in seen:
            seen[fid] = f
    return list(seen.values())


# ---------------------------------------------------------------------------
# Validation against schema contract
# ---------------------------------------------------------------------------
REQUIRED_FIELDS = [
    "id", "name", "lat", "lng", "type",
    "pollutants", "emissions_value", "emissions_unit", "year", "source",
]


def _validate_features(features: list[dict]) -> list[str]:
    """Return a list of validation errors (empty = pass)."""
    errors: list[str] = []
    for i, feat in enumerate(features):
        props = feat.get("properties", {})
        for field in REQUIRED_FIELDS:
            val = props.get(field)
            if val is None:
                errors.append(
                    f"Feature {i} ({props.get('id', '?')}): missing required field '{field}'"
                )
            elif field == "pollutants":
                if not isinstance(val, list) or len(val) == 0:
                    errors.append(f"Feature {i}: pollutants must be non-empty list")
        # Check geometry
        geom = feat.get("geometry", {})
        if geom.get("type") != "Point":
            errors.append(
                f"Feature {i}: geometry type must be Point, got {geom.get('type')}"
            )
        coords = geom.get("coordinates", [])
        if len(coords) != 2:
            errors.append(f"Feature {i}: coordinates must have 2 elements")
    return errors


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------
def main() -> None:
    log.info("=== ingest_emissions.py starting at %s ===", BUILD_TIMESTAMP)
    log.info("Output: %s", OUTPUT_FILE)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    all_features: list[dict] = []
    ghgrp_feature_count = 0
    echo_total = 0
    states_failed = 0

    # ------------------------------------------------------------------
    # Phase 1: GHGRP -- large emitters with real emissions values
    # ------------------------------------------------------------------
    log.info("--- Phase 1: EPA GHGRP %d ---", GHGRP_YEAR)
    try:
        ghgrp_facilities = _ghgrp_fetch_all_facilities()
        log.info("GHGRP: fetched %d facility records", len(ghgrp_facilities))

        time.sleep(2)

        ghgrp_emissions = _ghgrp_fetch_all_emissions()
        log.info("GHGRP: emissions data for %d facilities", len(ghgrp_emissions))

        ghgrp_features = _build_ghgrp_features(ghgrp_facilities, ghgrp_emissions)
        all_features.extend(ghgrp_features)
        ghgrp_feature_count = len(ghgrp_features)
        log.info("GHGRP: added %d features", ghgrp_feature_count)
    except Exception as exc:
        log.error("GHGRP ingestion FAILED: %s", exc)
        log.error("Continuing with ECHO only...")
        ghgrp_features = []

    # Build set of FRS IDs already covered by GHGRP to avoid ECHO duplication
    ghgrp_frs_ids: set[str] = {
        f["properties"].get("_frs_id", "")
        for f in all_features
        if f["properties"].get("_frs_id")
    }
    log.info("GHGRP FRS IDs collected: %d", len(ghgrp_frs_ids))

    # ------------------------------------------------------------------
    # Phase 2: ECHO -- supplemental state-by-state
    # ------------------------------------------------------------------
    log.info("--- Phase 2: EPA ECHO supplemental (all 50 states) ---")

    for idx, state in enumerate(US_STATES):
        log.info("  ECHO: fetching state %s (%d/%d)", state, idx + 1, len(US_STATES))
        try:
            rows = _echo_fetch_state(state)
            feats = _build_echo_features(rows, state, ghgrp_frs_ids)
            all_features.extend(feats)
            echo_total += len(feats)
            log.info("  ECHO %s: cumulative total = %d features", state, len(all_features))
        except Exception as exc:
            log.warning("  ECHO %s: FAILED -- %s", state, exc)
            states_failed += 1

        # Rate-limit: pause between state queries
        if idx < len(US_STATES) - 1:
            time.sleep(ECHO_MIN_DELAY)

    log.info("ECHO: added %d features total (%d states failed)", echo_total, states_failed)

    # ------------------------------------------------------------------
    # Phase 3: Deduplicate + finalize
    # ------------------------------------------------------------------
    log.info("--- Phase 3: dedup + finalize ---")
    log.info("Before dedup: %d features", len(all_features))
    all_features = _dedupe_features(all_features)
    log.info("After dedup: %d features", len(all_features))

    # Strip internal cache fields (prefixed with _) before output
    for feat in all_features:
        props = feat["properties"]
        internal = [k for k in list(props.keys()) if k.startswith("_")]
        for k in internal:
            del props[k]

    # ------------------------------------------------------------------
    # Phase 4: Validate against schema contract
    # ------------------------------------------------------------------
    log.info("--- Phase 4: schema validation ---")
    errors = _validate_features(all_features)
    if errors:
        for err in errors[:20]:
            log.error("VALIDATION: %s", err)
        if len(errors) > 20:
            log.error("... and %d more validation errors", len(errors) - 20)
        if len(errors) > max(len(all_features) * 0.01, 10):
            log.error("Validation error rate too high -- aborting write.")
            sys.exit(1)
        log.warning("%d validation errors but below threshold -- writing output.", len(errors))
    else:
        log.info("Validation passed: 0 errors on %d features.", len(all_features))

    # ------------------------------------------------------------------
    # Phase 5: Write output
    # ------------------------------------------------------------------
    feature_collection = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "EPA-GHGRP-2022 + EPA-ECHO-2024",
            "built_at": BUILD_TIMESTAMP,
            "record_count": len(all_features),
            "vintage": str(GHGRP_YEAR),
            "ghgrp_count": ghgrp_feature_count,
            "echo_count": echo_total,
        },
        "features": all_features,
    }

    log.info("Writing %d features to %s ...", len(all_features), OUTPUT_FILE)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(feature_collection, fh, ensure_ascii=False, separators=(",", ":"))

    size_mb = OUTPUT_FILE.stat().st_size / 1024 / 1024
    log.info("Wrote %.2f MB", size_mb)

    # ------------------------------------------------------------------
    # Phase 6: Summary
    # ------------------------------------------------------------------
    log.info("=== DONE ===")
    log.info("Output file : %s", OUTPUT_FILE)
    log.info("Record count: %d", len(all_features))
    log.info("GHGRP       : %d features (year %d)", ghgrp_feature_count, GHGRP_YEAR)
    log.info("ECHO suppl. : %d features", echo_total)
    log.info("Vintage     : GHGRP-%d / ECHO-2024", GHGRP_YEAR)
    log.info("Build ts    : %s", BUILD_TIMESTAMP)

    if len(all_features) < 5000:
        log.warning(
            "WARNING: Only %d features -- below the 5,000-record target. "
            "Check API availability and cache.",
            len(all_features),
        )


if __name__ == "__main__":
    main()
