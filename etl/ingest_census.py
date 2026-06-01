"""
ingest_census.py — Census ACS 5-Year (2022) tract-level demographics ingestor.

Outputs: /data/demographics.geojson

Flow:
1. Download 2022 Gazetteer tracts ZIP to get GEOID + centroid coordinates.
2. Query ACS API state-by-state for demographics variables.
3. Join on GEOID.
4. Compute pct_minority, handle suppressed income.
5. Filter to population > 0 with valid coordinates.
6. Write GeoJSON FeatureCollection.

Idempotent: safe to re-run; overwrites output file each time.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent
DATA_DIR = REPO_ROOT / "data"
OUTPUT_FILE = DATA_DIR / "demographics.geojson"

CENSUS_API_KEY = os.environ.get("CENSUS_API_KEY", "")
ACS_BASE_URL = "https://api.census.gov/data/2022/acs/acs5"
GAZETTEER_URL = (
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/"
    "2022_Gazetteer/2022_Gaz_tracts_national.zip"
)
ACS_VARIABLES = "B01003_001E,B19013_001E,B02001_001E,B02001_002E"
SOURCE_STRING = "census-acs5-2022"
SUPPRESSED_INCOME_SENTINEL = -666666666

# State FIPS codes: 50 states + DC + PR
STATE_FIPS = [
    "01", "02", "04", "05", "06", "08", "09", "10", "11", "12",
    "13", "15", "16", "17", "18", "19", "20", "21", "22", "23",
    "24", "25", "26", "27", "28", "29", "30", "31", "32", "33",
    "34", "35", "36", "37", "38", "39", "40", "41", "42", "44",
    "45", "46", "47", "48", "49", "50", "51", "53", "54", "55",
    "56", "72",
]

RATE_LIMIT_DELAY = 0.1  # seconds between API requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Step 1: Download Gazetteer tracts for GEOID → centroid mapping
# ---------------------------------------------------------------------------
def fetch_gazetteer_centroids() -> dict[str, tuple[float, float]]:
    """Return {geoid: (lat, lng)} from the 2022 national tracts gazetteer."""
    log.info("Downloading 2022 Gazetteer tracts ZIP from Census...")
    resp = requests.get(GAZETTEER_URL, timeout=120)
    resp.raise_for_status()
    log.info("Downloaded gazetteer ZIP (%d bytes). Parsing...", len(resp.content))

    centroids: dict[str, tuple[float, float]] = {}
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        # Find the .txt file inside the ZIP
        txt_files = [n for n in zf.namelist() if n.endswith(".txt")]
        if not txt_files:
            raise RuntimeError("No .txt file found in Gazetteer ZIP")
        fname = txt_files[0]
        log.info("Reading gazetteer file: %s", fname)
        with zf.open(fname) as f:
            # Gazetteer files are tab-delimited; first row is header
            reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8"), delimiter="\t")
            for row in reader:
                # Strip whitespace from all keys and values
                row = {k.strip(): v.strip() for k, v in row.items() if k}
                geoid = row.get("GEOID", "").strip()
                lat_str = row.get("INTPTLAT", "").strip()
                lng_str = row.get("INTPTLONG", "").strip()
                if not geoid or not lat_str or not lng_str:
                    continue
                try:
                    lat = float(lat_str)
                    lng = float(lng_str)
                except ValueError:
                    continue
                # Ensure 11-digit zero-padded GEOID
                centroids[geoid.zfill(11)] = (lat, lng)

    log.info("Loaded %d tract centroids from Gazetteer.", len(centroids))
    return centroids


# ---------------------------------------------------------------------------
# Step 2: Fetch ACS demographics for one state
# ---------------------------------------------------------------------------
def fetch_acs_state(state_fips: str) -> list[dict[str, Any]] | None:
    """
    Fetch ACS variables for all tracts in one state.
    Returns list of dicts, or None on failure.
    """
    params: dict[str, str] = {
        "get": ACS_VARIABLES,
        "for": "tract:*",
        "in": f"state:{state_fips}",
        "key": CENSUS_API_KEY,
    }
    try:
        resp = requests.get(ACS_BASE_URL, params=params, timeout=60)
        if resp.status_code == 204:
            log.warning("State %s: 204 No Content from ACS API — skipping.", state_fips)
            return None
        if resp.status_code != 200:
            log.warning(
                "State %s: HTTP %d from ACS API — skipping. Response: %s",
                state_fips, resp.status_code, resp.text[:200],
            )
            return None
        data = resp.json()
    except requests.RequestException as exc:
        log.warning("State %s: request error — %s — skipping.", state_fips, exc)
        return None
    except json.JSONDecodeError as exc:
        log.warning("State %s: JSON decode error — %s — skipping.", state_fips, exc)
        return None

    if not isinstance(data, list) or len(data) < 2:
        log.warning("State %s: unexpected ACS response format — skipping.", state_fips)
        return None

    headers = [h.strip() for h in data[0]]
    rows = data[1:]
    results: list[dict[str, Any]] = []
    for row in rows:
        record: dict[str, Any] = dict(zip(headers, row))
        results.append(record)
    return results


# ---------------------------------------------------------------------------
# Step 3: Build features
# ---------------------------------------------------------------------------
def build_features(
    centroids: dict[str, tuple[float, float]],
    acs_records: list[dict[str, Any]],
    build_ts: str,
) -> list[dict[str, Any]]:
    """Convert ACS records + centroid lookup into GeoJSON features."""
    features: list[dict[str, Any]] = []
    skipped_no_centroid = 0
    skipped_zero_pop = 0
    skipped_bad_data = 0

    for record in acs_records:
        # Build GEOID from state + county + tract components
        state = record.get("state", "").zfill(2)
        county = record.get("county", "").zfill(3)
        tract = record.get("tract", "").zfill(6)
        geoid = f"{state}{county}{tract}"

        if len(geoid) != 11:
            skipped_bad_data += 1
            continue

        # Look up centroid
        coords = centroids.get(geoid)
        if coords is None:
            skipped_no_centroid += 1
            continue
        lat, lng = coords

        # Parse population
        try:
            population = int(record.get("B01003_001E", 0) or 0)
        except (ValueError, TypeError):
            skipped_bad_data += 1
            continue

        if population <= 0:
            skipped_zero_pop += 1
            continue

        # Parse median income (null if suppressed or missing)
        try:
            raw_income = int(record.get("B19013_001E", 0) or 0)
            median_income: float | None = (
                None if raw_income == SUPPRESSED_INCOME_SENTINEL else float(raw_income)
            )
        except (ValueError, TypeError):
            median_income = None

        # Compute pct_minority
        try:
            total_race = int(record.get("B02001_001E", 0) or 0)
            white_alone = int(record.get("B02001_002E", 0) or 0)
            if total_race > 0:
                pct_minority = 1.0 - (white_alone / total_race)
                pct_minority = max(0.0, min(1.0, pct_minority))
            else:
                pct_minority = 0.0
        except (ValueError, TypeError, ZeroDivisionError):
            pct_minority = 0.0

        feature: dict[str, Any] = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [lng, lat],
            },
            "properties": {
                "geoid": geoid,
                "lat": lat,
                "lng": lng,
                "population": population,
                "median_income": median_income,
                "pct_minority": round(pct_minority, 6),
                "source": SOURCE_STRING,
                "build_timestamp": build_ts,
            },
        }
        features.append(feature)

    log.info(
        "Built %d features. Skipped: no_centroid=%d, zero_pop=%d, bad_data=%d",
        len(features), skipped_no_centroid, skipped_zero_pop, skipped_bad_data,
    )
    return features


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    if not CENSUS_API_KEY:
        raise RuntimeError(
            "CENSUS_API_KEY environment variable is not set. "
            "Export it before running this script."
        )

    build_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    log.info("Build timestamp: %s", build_ts)

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Step 1: Gazetteer centroids
    centroids = fetch_gazetteer_centroids()

    # Step 2: ACS demographics, state by state
    all_acs_records: list[dict[str, Any]] = []
    failed_states: list[str] = []

    for i, state_fips in enumerate(STATE_FIPS):
        log.info(
            "Fetching ACS for state %s (%d/%d)...", state_fips, i + 1, len(STATE_FIPS)
        )
        records = fetch_acs_state(state_fips)
        if records is None:
            failed_states.append(state_fips)
        else:
            all_acs_records.extend(records)
            log.info("  -> %d tract records for state %s", len(records), state_fips)
        time.sleep(RATE_LIMIT_DELAY)

    log.info(
        "ACS fetch complete. Total records: %d. Failed states: %s",
        len(all_acs_records),
        failed_states if failed_states else "none",
    )

    if not all_acs_records:
        raise RuntimeError(
            "No ACS records retrieved. Check API key and connectivity. "
            "Do not fabricate data — aborting."
        )

    # Step 3: Build GeoJSON features
    features = build_features(centroids, all_acs_records, build_ts)

    if len(features) < 60000:
        log.warning(
            "Feature count %d is lower than expected (~70k-80k). "
            "Check for missing states or centroid mismatches.",
            len(features),
        )

    # Step 4: Write output
    geojson: dict[str, Any] = {
        "type": "FeatureCollection",
        "features": features,
        "_meta": {
            "source": SOURCE_STRING,
            "build_timestamp": build_ts,
            "record_count": len(features),
            "failed_states": failed_states,
            "vintage": "2022",
            "variables": ACS_VARIABLES,
        },
    }

    log.info("Writing %d features to %s ...", len(features), OUTPUT_FILE)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(geojson, f, separators=(",", ":"))
    log.info("Done. Output: %s (%d features)", OUTPUT_FILE, len(features))

    # Report any failed states
    if failed_states:
        log.warning(
            "The following states failed and were skipped (no data fabricated): %s",
            failed_states,
        )


# ---------------------------------------------------------------------------
# Validation helper (run after main to self-check)
# ---------------------------------------------------------------------------
def validate_output() -> None:
    """Load the written GeoJSON and verify it meets the schema contract."""
    log.info("Validating output file: %s", OUTPUT_FILE)
    with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    assert data["type"] == "FeatureCollection", "Root type must be FeatureCollection"
    features = data["features"]
    assert len(features) > 0, "FeatureCollection must not be empty"

    required_props = {"geoid", "lat", "lng", "population", "pct_minority", "source"}
    errors: list[str] = []

    for i, feat in enumerate(features):
        if feat.get("type") != "Feature":
            errors.append(f"Feature {i}: type != 'Feature'")
            continue
        geom = feat.get("geometry", {})
        if geom.get("type") != "Point":
            errors.append(f"Feature {i}: geometry type != 'Point'")
        coords = geom.get("coordinates", [])
        if len(coords) != 2:
            errors.append(f"Feature {i}: coordinates must have 2 elements")

        props = feat.get("properties", {})
        missing = required_props - set(props.keys())
        if missing:
            errors.append(f"Feature {i} (geoid={props.get('geoid')}): missing fields {missing}")

        geoid = props.get("geoid", "")
        if not isinstance(geoid, str) or len(geoid) != 11:
            errors.append(f"Feature {i}: invalid geoid '{geoid}'")

        pop = props.get("population")
        if not isinstance(pop, int) or pop <= 0:
            errors.append(f"Feature {i} geoid={geoid}: population must be int > 0, got {pop!r}")

        pct = props.get("pct_minority")
        if not isinstance(pct, float) or not (0.0 <= pct <= 1.0):
            errors.append(f"Feature {i} geoid={geoid}: pct_minority out of range: {pct!r}")

        src = props.get("source")
        if src != SOURCE_STRING:
            errors.append(f"Feature {i} geoid={geoid}: source='{src}', expected '{SOURCE_STRING}'")

        if i >= 500:
            # Spot-check first 500; full scan would be slow for 70k records
            break

    if errors:
        for err in errors[:20]:
            log.error("VALIDATION ERROR: %s", err)
        raise AssertionError(f"Validation failed with {len(errors)} error(s). First shown above.")

    log.info(
        "Validation passed. %d features, spot-checked first 500.", len(features)
    )


if __name__ == "__main__":
    main()
    validate_output()
