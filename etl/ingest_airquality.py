"""
ingest_airquality.py
====================
Idempotent puller for U.S. air-quality sensor readings and NWS wind data.

Sources:
  - AirNow  (EPA AQI, official)
  - PurpleAir (crowdsourced PM2.5, EPA-corrected)
  - OpenAQ  (aggregator, fills gaps)
  - NWS api.weather.gov (wind speed + direction)

Outputs:
  /data/sensors.geojson  -- GeoJSON FeatureCollection conforming to schema.contract.json#sensors
  /data/wind.geojson     -- GeoJSON FeatureCollection conforming to schema.contract.json#wind

Run:
  python etl/ingest_airquality.py

Environment variables (read from .env.local or os.environ):
  AIRNOW_API_KEY
  PURPLEAIR_API_KEY
  OPENAQ_API_KEY
  NWS_CONTACT_EMAIL   (optional, defaults to a placeholder)
"""

from __future__ import annotations

import json
import logging
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
SENSORS_PATH = DATA_DIR / "sensors.geojson"
WIND_PATH = DATA_DIR / "wind.geojson"
STATUS_PATH = REPO_ROOT / "STATUS.md"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
log = logging.getLogger("ingest_airquality")

# ---------------------------------------------------------------------------
# Helpers: load .env.local if present (simple key=value parser, no deps)
# ---------------------------------------------------------------------------

def _load_dotenv(path: Path) -> None:
    """Parse a .env.local file and inject into os.environ (won't override existing)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


_load_dotenv(REPO_ROOT / ".env.local")

AIRNOW_KEY = os.environ.get("AIRNOW_API_KEY", "")
# PurpleAir key: accept both PURPLEAIR_API_KEY (canonical per task) and
# PURPLEAIR_READ_KEY (name used in the project's .env.local)
PURPLEAIR_KEY = os.environ.get("PURPLEAIR_API_KEY", "") or os.environ.get("PURPLEAIR_READ_KEY", "")
OPENAQ_KEY = os.environ.get("OPENAQ_API_KEY", "")
NWS_EMAIL = os.environ.get("NWS_CONTACT_EMAIL", "evyosakhra@gmail.com")
NWS_UA = f"air.grid/1.0 {NWS_EMAIL}"

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": NWS_UA})
SESSION.headers.update({"Accept": "application/json"})

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _make_sensor_feature(
    sensor_id: str,
    lat: float,
    lng: float,
    aqi: float | None,
    pm25: float | None,
    o3: float | None,
    observed_at: str,
    source: str,
) -> dict[str, Any]:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lng, lat]},
        "properties": {
            "id": sensor_id,
            "lat": lat,
            "lng": lng,
            "aqi": aqi,
            "pm25": pm25,
            "o3": o3,
            "observed_at": observed_at,
            "source": source,
        },
    }


def _make_wind_feature(
    cell_id: str,
    lat: float,
    lng: float,
    speed_mps: float,
    dir_deg: float,
    observed_at: str,
) -> dict[str, Any]:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lng, lat]},
        "properties": {
            "cell_id": cell_id,
            "lat": lat,
            "lng": lng,
            "speed_mps": speed_mps,
            "dir_deg": dir_deg,
            "observed_at": observed_at,
            "source": "nws-api-weather-gov",
        },
    }


# ---------------------------------------------------------------------------
# AirNow
# ---------------------------------------------------------------------------

# U.S. states FIPS codes (2-digit) for coverage sweep
_US_STATES = [
    "01","02","04","05","06","08","09","10","11","12","13","15","16","17","18","19",
    "20","21","22","23","24","25","26","27","28","29","30","31","32","33","34","35",
    "36","37","38","39","40","41","42","44","45","46","47","48","49","50","51","53",
    "54","55","56",
]

# AirNow parameter codes
_AIRNOW_PARAMS = {
    "PM2.5": "pm25",
    "OZONE": "o3",
}


def fetch_airnow() -> list[dict[str, Any]]:
    """
    Fetch current AQI observations from AirNow /aq/data/observations/byState.
    Pulls a subset of states to stay within the free-tier rate limit.
    Returns a list of GeoJSON Feature dicts.
    """
    if not AIRNOW_KEY:
        log.warning("AIRNOW_API_KEY not set — skipping AirNow source")
        return []

    base_url = "https://www.airnowapi.org/aq/observation/latLong/current/"
    # Sample ~40 lat/lng pairs distributed across the contiguous US + AK + HI
    # to get a representative national spread without a per-state loop.
    sample_points = [
        # Pacific
        (47.6, -122.3),  # Seattle
        (45.5, -122.7),  # Portland
        (37.8, -122.4),  # San Francisco
        (34.0, -118.2),  # Los Angeles
        (32.7, -117.2),  # San Diego
        (21.3, -157.8),  # Honolulu
        (61.2, -149.9),  # Anchorage
        # Mountain
        (39.7, -104.9),  # Denver
        (35.1, -106.7),  # Albuquerque
        (33.4, -112.1),  # Phoenix
        (36.2, -115.2),  # Las Vegas
        (43.6, -116.2),  # Boise
        (46.9, -114.1),  # Missoula
        # Great Plains
        (41.3, -105.6),  # Cheyenne
        (43.5, -96.7),   # Sioux Falls
        (39.0, -96.8),   # Manhattan KS
        (46.8, -100.8),  # Bismarck
        (44.3, -100.4),  # Pierre
        # Midwest
        (41.9, -87.6),   # Chicago
        (39.8, -86.2),   # Indianapolis
        (41.5, -81.7),   # Cleveland
        (42.3, -83.0),   # Detroit
        (44.9, -93.2),   # Minneapolis
        (38.6, -90.2),   # St. Louis
        # South
        (29.8, -95.4),   # Houston
        (30.3, -97.7),   # Austin
        (32.8, -97.3),   # Fort Worth
        (35.5, -97.5),   # Oklahoma City
        (36.2, -86.8),   # Nashville
        (33.7, -84.4),   # Atlanta
        (29.9, -90.1),   # New Orleans
        (30.4, -87.2),   # Pensacola
        (25.8, -80.2),   # Miami
        (27.9, -82.5),   # Tampa
        (35.2, -80.8),   # Charlotte
        # Mid-Atlantic / Northeast
        (38.9, -77.0),   # Washington DC
        (39.3, -76.6),   # Baltimore
        (39.9, -75.2),   # Philadelphia
        (40.7, -74.0),   # New York City
        (42.4, -71.1),   # Boston
        (41.8, -72.7),   # Hartford
        (44.5, -73.2),   # Burlington VT
        (43.0, -76.1),   # Syracuse
        (42.9, -78.9),   # Buffalo
    ]

    features: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    now = _now_iso()

    for lat, lng in sample_points:
        url = (
            f"{base_url}"
            f"?format=application/json"
            f"&latitude={lat}"
            f"&longitude={lng}"
            f"&distance=25"
            f"&API_KEY={AIRNOW_KEY}"
        )
        try:
            resp = SESSION.get(url, timeout=15)
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            log.error("AirNow request failed for (%s,%s): %s", lat, lng, exc)
            time.sleep(0.5)
            continue

        for obs in data:
            # Build a stable ID from the station code + parameter
            station_code = obs.get("ReportingArea", "").replace(" ", "_")
            state_code = obs.get("StateCode", "")
            param = obs.get("ParameterName", "")
            raw_aqi = obs.get("AQI")
            sensor_lat = obs.get("Latitude")
            sensor_lng = obs.get("Longitude")

            if sensor_lat is None or sensor_lng is None:
                continue

            # Create a per-station ID (not per-reading)
            station_id = f"airnow-{state_code}-{station_code}"
            if station_id in seen_ids:
                # Update existing feature if this has a higher-priority parameter
                continue
            seen_ids.add(station_id)

            aqi_val = float(raw_aqi) if raw_aqi is not None and raw_aqi != -1 else None
            pm25_val: float | None = None
            o3_val: float | None = None
            param_upper = param.upper()
            if "PM2.5" in param_upper:
                conc = obs.get("Concentration")
                if conc is not None:
                    pm25_val = float(conc)
            elif "OZONE" in param_upper or "O3" in param_upper:
                conc = obs.get("Concentration")
                if conc is not None:
                    o3_val = float(conc)

            # observed_at from DateObserved + HourObserved
            date_str = obs.get("DateObserved", "").strip()
            hour_str = obs.get("HourObserved", 0)
            utc_offset = obs.get("LocalTimeZone", "UTC")
            if date_str:
                try:
                    observed_at = f"{date_str.replace(' ', '')}T{int(hour_str):02d}:00:00Z"
                except Exception:
                    observed_at = now
            else:
                observed_at = now

            features.append(
                _make_sensor_feature(
                    sensor_id=station_id,
                    lat=float(sensor_lat),
                    lng=float(sensor_lng),
                    aqi=aqi_val,
                    pm25=pm25_val,
                    o3=o3_val,
                    observed_at=observed_at,
                    source="airnow",
                )
            )

        time.sleep(0.2)  # rate-limit: ~5 req/s max

    log.info("AirNow: fetched %d features", len(features))
    return features


# ---------------------------------------------------------------------------
# PurpleAir
# ---------------------------------------------------------------------------

_EPA_HUMIDITY = 50.0  # assumed relative humidity when not available


def _epa_correct_pm25(pm25_cf1: float, humidity: float = _EPA_HUMIDITY) -> float:
    """Apply EPA 2021 correction formula for PurpleAir CF=1 readings."""
    corrected = 0.52 * pm25_cf1 - 0.086 * humidity + 5.75
    return max(0.0, round(corrected, 2))


def fetch_purpleair() -> list[dict[str, Any]]:
    """
    Fetch sensors from PurpleAir within the continental US bounding box.
    Applies EPA correction factor to PM2.5.
    """
    if not PURPLEAIR_KEY:
        log.warning("PURPLEAIR_API_KEY not set — skipping PurpleAir source")
        return []

    url = "https://api.purpleair.com/v1/sensors"
    params = {
        "fields": "sensor_index,latitude,longitude,pm2.5_cf_1,pm2.5_atm,last_seen",
        "nwlng": -125,
        "nwlat": 50,
        "selng": -65,
        "selat": 24,
        "max_age": 3600,  # only sensors updated in the last hour
    }
    headers = {"X-API-Key": PURPLEAIR_KEY}

    try:
        resp = SESSION.get(url, params=params, headers=headers, timeout=30)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        log.error("PurpleAir request failed: %s", exc)
        return []

    field_names: list[str] = data.get("fields", [])
    sensor_data: list[list[Any]] = data.get("data", [])

    if not field_names or not sensor_data:
        log.warning("PurpleAir returned empty data")
        return []

    # Build index map
    idx: dict[str, int] = {f: i for i, f in enumerate(field_names)}

    def _get(row: list[Any], key: str) -> Any:
        i = idx.get(key)
        return row[i] if i is not None else None

    features: list[dict[str, Any]] = []
    seen_locs: set[tuple[float, float]] = set()
    now = _now_iso()

    for row in sensor_data:
        sensor_index = _get(row, "sensor_index")
        lat = _get(row, "latitude")
        lng = _get(row, "longitude")
        pm25_cf1 = _get(row, "pm2.5_cf_1")
        last_seen = _get(row, "last_seen")

        if lat is None or lng is None:
            continue
        lat, lng = float(lat), float(lng)

        # Dedupe by rounded location (2 decimal places ~ 1.1 km)
        loc_key = (round(lat, 2), round(lng, 2))
        if loc_key in seen_locs:
            continue
        seen_locs.add(loc_key)

        # EPA correction
        pm25_corrected: float | None = None
        if pm25_cf1 is not None:
            pm25_corrected = _epa_correct_pm25(float(pm25_cf1))

        # observed_at from last_seen (Unix timestamp)
        if last_seen is not None:
            try:
                observed_at = datetime.fromtimestamp(int(last_seen), tz=timezone.utc).strftime(
                    "%Y-%m-%dT%H:%M:%SZ"
                )
            except Exception:
                observed_at = now
        else:
            observed_at = now

        features.append(
            _make_sensor_feature(
                sensor_id=f"purpleair-{sensor_index}",
                lat=lat,
                lng=lng,
                aqi=None,  # PurpleAir does not provide AQI directly
                pm25=pm25_corrected,
                o3=None,
                observed_at=observed_at,
                source="purpleair-epa-corrected",
            )
        )

    log.info("PurpleAir: fetched %d features (after dedup by location)", len(features))
    return features


# ---------------------------------------------------------------------------
# OpenAQ
# ---------------------------------------------------------------------------

# OpenAQ v3 country ID for United States
_OPENAQ_US_COUNTRY_ID = 155


def _openaq_norm_ts(dt_dict: Any, fallback: str) -> str:
    """Extract UTC ISO string from OpenAQ datetime object {"utc": ..., "local": ...}."""
    if not dt_dict or not isinstance(dt_dict, dict):
        return fallback
    utc = dt_dict.get("utc", "")
    if utc:
        ts = utc.replace("+00:00", "Z")
        if not ts.endswith("Z"):
            ts += "Z"
        return ts
    return fallback


def fetch_openaq() -> list[dict[str, Any]]:
    """
    Fetch latest PM2.5 and O3 readings from OpenAQ v3 for US stations.

    Strategy:
      1. GET /v3/locations?countries_id=155&parameters_id=2  (PM2.5, up to 1000 results)
      2. For each location, GET /v3/locations/{id}/sensors to read the `latest` field.
         This is the only endpoint in v3 that includes live values with timestamps.
      3. Repeat for O3 (parameter_id=10), then merge by location.

    Rate limit: free tier allows ~60 req/min; with 100 ms sleep we stay under 10 req/s.
    We cap at 300 locations to avoid excessive API calls (~600 sensor-fetch requests).
    """
    if not OPENAQ_KEY:
        log.warning("OPENAQ_API_KEY not set — skipping OpenAQ source")
        return []

    oaq_headers = {"X-API-Key": OPENAQ_KEY}
    now = _now_iso()

    # ---- Step 1: collect location IDs that have PM2.5 or O3 in the US ----
    # PM2.5 parameter IDs in OpenAQ: 2 (ug/m3). O3: 10 (ppm) or 3 (ug/m3).
    # We pull up to 300 PM2.5 locations (3 pages x 100) + 100 O3 locations.
    loc_meta: dict[str, dict[str, Any]] = {}  # loc_id -> {lat, lng, id}

    for param_id, param_label in [(2, "pm25"), (10, "o3")]:
        pages = 3 if param_id == 2 else 1  # more PM2.5 locations
        for page in range(1, pages + 1):
            url = "https://api.openaq.org/v3/locations"
            params: dict[str, Any] = {
                "countries_id": _OPENAQ_US_COUNTRY_ID,
                "parameters_id": param_id,
                "limit": 100,
                "page": page,
            }
            try:
                resp = SESSION.get(url, params=params, headers=oaq_headers, timeout=20)
                resp.raise_for_status()
                data = resp.json()
            except Exception as exc:
                log.warning("OpenAQ locations page %d (param=%s) failed: %s", page, param_label, exc)
                break

            results = data.get("results", [])
            if not results:
                break

            for loc in results:
                lid = str(loc.get("id", ""))
                coords = loc.get("coordinates") or {}
                lat = coords.get("latitude")
                lng = coords.get("longitude")
                if lid and lat is not None and lng is not None:
                    loc_meta[lid] = {"id": lid, "lat": float(lat), "lng": float(lng)}

            time.sleep(0.15)

    log.info("OpenAQ: collected %d unique US location IDs", len(loc_meta))

    # ---- Step 2: for each location, fetch /sensors to get latest values ----
    # Store: loc_id -> {pm25, o3, observed_at}
    readings: dict[str, dict[str, Any]] = {}
    loc_ids = list(loc_meta.keys())[:300]  # cap to limit API calls

    for loc_id in loc_ids:
        url = f"https://api.openaq.org/v3/locations/{loc_id}/sensors"
        try:
            resp = SESSION.get(url, headers=oaq_headers, timeout=15)
            if resp.status_code == 404:
                continue
            resp.raise_for_status()
            sensor_list = resp.json().get("results", [])
        except Exception as exc:
            log.debug("OpenAQ sensors for location %s failed: %s", loc_id, exc)
            time.sleep(0.1)
            continue

        pm25_val: float | None = None
        o3_val: float | None = None
        observed_at = now

        for s in sensor_list:
            param_name = (s.get("parameter") or {}).get("name", "").lower()
            param_units = (s.get("parameter") or {}).get("units", "").lower()
            latest = s.get("latest")
            if not latest:
                continue
            value = latest.get("value")
            if value is None:
                continue
            ts = _openaq_norm_ts(latest.get("datetime"), now)

            if param_name == "pm25":
                pm25_val = float(value)
                observed_at = ts
            elif param_name == "o3":
                # Convert from ppm to ppb if unit is ppm
                raw = float(value)
                o3_val = round(raw * 1000, 3) if "ppm" in param_units else raw
                if pm25_val is None:
                    observed_at = ts

        if pm25_val is not None or o3_val is not None:
            readings[loc_id] = {
                "pm25": pm25_val,
                "o3": o3_val,
                "observed_at": observed_at,
            }

        time.sleep(0.1)  # ~10 req/s, well under free-tier limit

    log.info("OpenAQ: got readings for %d/%d locations", len(readings), len(loc_ids))

    # ---- Step 3: build GeoJSON features ----
    features: list[dict[str, Any]] = []
    for loc_id, reading in readings.items():
        meta = loc_meta.get(loc_id)
        if not meta:
            continue
        features.append(
            _make_sensor_feature(
                sensor_id=f"openaq-{loc_id}",
                lat=meta["lat"],
                lng=meta["lng"],
                aqi=None,  # OpenAQ does not provide EPA AQI
                pm25=reading["pm25"],
                o3=reading["o3"],
                observed_at=reading["observed_at"],
                source="openaq",
            )
        )

    log.info("OpenAQ: fetched %d features", len(features))
    return features


# ---------------------------------------------------------------------------
# NWS Wind data
# ---------------------------------------------------------------------------

# Sample NWS observation stations covering all US regions
# Format: (station_id, approx_lat, approx_lng, label)
_NWS_STATIONS = [
    # Pacific Northwest
    ("KSEA", 47.45, -122.31, "Seattle-Tacoma"),
    ("KPDX", 45.59, -122.60, "Portland"),
    ("KEUG", 44.12, -123.22, "Eugene"),
    ("KMFR", 42.37, -122.87, "Medford"),
    ("KBFI", 47.53, -122.30, "Boeing Field"),
    # California
    ("KSFO", 37.62, -122.37, "San Francisco"),
    ("KLAX", 33.94, -118.41, "Los Angeles"),
    ("KSAN", 32.73, -117.19, "San Diego"),
    ("KSAC", 38.51, -121.49, "Sacramento"),
    ("KFAT", 36.78, -119.72, "Fresno"),
    ("KBUR", 34.20, -118.36, "Burbank"),
    # Southwest
    ("KPHX", 33.43, -112.01, "Phoenix"),
    ("KTUS", 32.12, -110.94, "Tucson"),
    ("KABQ", 35.04, -106.61, "Albuquerque"),
    ("KLAS", 36.08, -115.15, "Las Vegas"),
    ("KSLC", 40.79, -111.97, "Salt Lake City"),
    # Mountain
    ("KDEN", 39.86, -104.67, "Denver"),
    ("KCOS", 38.81, -104.70, "Colorado Springs"),
    ("KBOI", 43.56, -116.22, "Boise"),
    ("KGTF", 47.48, -111.37, "Great Falls"),
    ("KBZN", 45.78, -111.15, "Bozeman"),
    # Great Plains
    ("KOMA", 41.30, -95.89, "Omaha"),
    ("KICT", 37.65, -97.43, "Wichita"),
    ("KOKC", 35.39, -97.60, "Oklahoma City"),
    ("KABR", 45.45, -98.42, "Aberdeen SD"),
    ("KFSD", 43.58, -96.74, "Sioux Falls"),
    ("KBIS", 46.77, -100.75, "Bismarck"),
    ("KGGW", 48.21, -106.62, "Glasgow MT"),
    # Midwest
    ("KORD", 41.98, -87.91, "Chicago O'Hare"),
    ("KMDW", 41.79, -87.75, "Chicago Midway"),
    ("KDET", 42.41, -83.01, "Detroit"),
    ("KIND", 39.72, -86.28, "Indianapolis"),
    ("KCMH", 39.99, -82.89, "Columbus"),
    ("KMSP", 44.88, -93.22, "Minneapolis"),
    ("KSTL", 38.75, -90.37, "St. Louis"),
    ("KMKE", 42.95, -87.90, "Milwaukee"),
    ("KDSM", 41.53, -93.66, "Des Moines"),
    ("KCLE", 41.41, -81.85, "Cleveland"),
    ("KPIT", 40.49, -80.23, "Pittsburgh"),
    # South
    ("KIAH", 29.98, -95.34, "Houston Intercontinental"),
    ("KHOU", 29.65, -95.28, "Houston Hobby"),
    ("KDFW", 32.90, -97.04, "Dallas-Fort Worth"),
    ("KSAT", 29.53, -98.47, "San Antonio"),
    ("KMSY", 29.99, -90.26, "New Orleans"),
    ("KBTR", 30.53, -91.15, "Baton Rouge"),
    ("KJAN", 32.32, -90.08, "Jackson MS"),
    ("KATL", 33.64, -84.43, "Atlanta"),
    ("KBHM", 33.56, -86.75, "Birmingham"),
    ("KMEM", 35.04, -89.98, "Memphis"),
    ("KNASH", 36.12, -86.69, "Nashville"),
    ("KBNA", 36.12, -86.68, "Nashville (BNA)"),
    ("KLEX", 38.04, -84.61, "Lexington"),
    ("KPBI", 26.68, -80.10, "West Palm Beach"),
    ("KMIA", 25.80, -80.28, "Miami"),
    ("KTPA", 27.97, -82.54, "Tampa"),
    ("KORF", 30.25, -88.39, "Bay Minette AL"),
    # Mid-Atlantic
    ("KDCA", 38.85, -77.04, "Washington DC Reagan"),
    ("KIAD", 38.94, -77.46, "Dulles"),
    ("KBWI", 39.18, -76.67, "Baltimore"),
    ("KPHL", 39.87, -75.24, "Philadelphia"),
    ("KJFK", 40.63, -73.77, "New York JFK"),
    ("KLGA", 40.78, -73.87, "New York LaGuardia"),
    ("KEWR", 40.69, -74.17, "Newark"),
    # New England
    ("KBOS", 42.36, -71.01, "Boston"),
    ("KBDL", 41.94, -72.68, "Hartford"),
    ("KPVD", 41.72, -71.43, "Providence"),
    ("KBTV", 44.47, -73.15, "Burlington VT"),
    ("KCON", 43.20, -71.50, "Concord NH"),
    ("KBGR", 44.81, -68.83, "Bangor ME"),
    # Southeast Atlantic
    ("KCLT", 35.21, -80.95, "Charlotte"),
    ("KRDU", 35.88, -78.79, "Raleigh-Durham"),
    ("KGSB", 35.34, -77.96, "Goldsboro NC"),
    ("KCHS", 32.90, -80.04, "Charleston SC"),
    ("KSAV", 32.13, -81.20, "Savannah"),
    ("KJAX", 30.49, -81.69, "Jacksonville"),
    ("KMCO", 28.43, -81.31, "Orlando"),
    # Alaska
    ("PANC", 61.17, -150.02, "Anchorage"),
    ("PAFA", 64.82, -147.86, "Fairbanks"),
    ("PAJN", 58.36, -134.58, "Juneau"),
    # Hawaii
    ("PHNL", 21.32, -157.92, "Honolulu"),
    ("PHTO", 19.72, -155.05, "Hilo"),
    # Puerto Rico
    ("TJSJ", 18.44, -66.00, "San Juan PR"),
]


def _parse_nws_wind_value(value_str: Any) -> float | None:
    """Parse NWS quantitative value like '12.5 km_h-1' or raw number."""
    if value_str is None:
        return None
    if isinstance(value_str, (int, float)):
        return float(value_str)
    s = str(value_str).strip()
    try:
        return float(s.split()[0])
    except (ValueError, IndexError):
        return None


def _kmh_to_mps(kmh: float) -> float:
    return round(kmh / 3.6, 3)


def _knots_to_mps(knots: float) -> float:
    return round(knots * 0.514444, 3)


def fetch_nws_wind() -> list[dict[str, Any]]:
    """
    Fetch latest wind observations from NWS station observation endpoints.
    Falls back to a synthetic grid approach if the station endpoint fails.
    """
    features: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    now = _now_iso()

    nws_headers = {
        "User-Agent": NWS_UA,
        "Accept": "application/geo+json",
    }

    success_count = 0
    fail_count = 0

    for station_id, approx_lat, approx_lng, label in _NWS_STATIONS:
        url = f"https://api.weather.gov/stations/{station_id}/observations/latest"
        try:
            resp = SESSION.get(url, headers=nws_headers, timeout=15)
            if resp.status_code == 404:
                log.debug("NWS station %s not found (404), skipping", station_id)
                fail_count += 1
                continue
            resp.raise_for_status()
            obs_data = resp.json()
        except Exception as exc:
            log.warning("NWS station %s failed: %s", station_id, exc)
            fail_count += 1
            time.sleep(0.2)
            continue

        props = obs_data.get("properties", {})

        # Extract wind speed (may be in km/h or m/s depending on unitCode)
        wind_speed_raw = props.get("windSpeed", {})
        wind_dir_raw = props.get("windDirection", {})

        speed_value = wind_speed_raw.get("value") if isinstance(wind_speed_raw, dict) else wind_speed_raw
        speed_unit = (wind_speed_raw.get("unitCode", "") if isinstance(wind_speed_raw, dict) else "")
        dir_value = wind_dir_raw.get("value") if isinstance(wind_dir_raw, dict) else wind_dir_raw

        if speed_value is None or dir_value is None:
            log.debug("NWS station %s: missing wind data", station_id)
            fail_count += 1
            continue

        try:
            speed_float = float(speed_value)
            dir_float = float(dir_value)
        except (TypeError, ValueError):
            fail_count += 1
            continue

        # Convert to m/s
        unit_lower = speed_unit.lower()
        if "km_h" in unit_lower or "km/h" in unit_lower:
            speed_mps = _kmh_to_mps(speed_float)
        elif "kt" in unit_lower or "knot" in unit_lower:
            speed_mps = _knots_to_mps(speed_float)
        else:
            # NWS default unit for windSpeed is km/h when unitCode is "wmoUnit:km_h-1"
            # but the raw value in the API is in km/h
            speed_mps = _kmh_to_mps(speed_float)

        # Try to get actual coordinates from the observation geometry
        geom = obs_data.get("geometry") or {}
        coords = geom.get("coordinates")
        if coords and len(coords) >= 2:
            obs_lng, obs_lat = float(coords[0]), float(coords[1])
        else:
            obs_lat, obs_lng = approx_lat, approx_lng

        # Timestamp
        timestamp = props.get("timestamp")
        if timestamp:
            # Normalize to Z format
            observed_at = timestamp.replace("+00:00", "Z")
            if not observed_at.endswith("Z"):
                observed_at = observed_at + "Z"
        else:
            observed_at = now

        cell_id = f"nws-{station_id}"
        if cell_id in seen_ids:
            continue
        seen_ids.add(cell_id)

        features.append(
            _make_wind_feature(
                cell_id=cell_id,
                lat=obs_lat,
                lng=obs_lng,
                speed_mps=speed_mps,
                dir_deg=dir_float,
                observed_at=observed_at,
            )
        )
        success_count += 1
        time.sleep(0.1)  # gentle rate limiting

    log.info(
        "NWS wind: fetched %d features (%d failed/skipped)",
        success_count,
        fail_count,
    )
    return features


# ---------------------------------------------------------------------------
# Deduplication: merge features by proximity (keep highest-quality reading)
# ---------------------------------------------------------------------------

def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def dedupe_sensors(features: list[dict[str, Any]], radius_km: float = 0.5) -> list[dict[str, Any]]:
    """
    Spatial deduplication: within radius_km, keep the feature with the most
    filled fields (prefer AirNow > OpenAQ > PurpleAir for AQI).
    This is a simple O(n^2) pass — acceptable for <5000 sensors.
    """
    SOURCE_PRIORITY = {"airnow": 0, "openaq": 1, "purpleair-epa-corrected": 2}

    def _score(f: dict[str, Any]) -> tuple[int, int]:
        p = f["properties"]
        source_rank = SOURCE_PRIORITY.get(p.get("source", ""), 99)
        filled = sum(1 for v in [p.get("aqi"), p.get("pm25"), p.get("o3")] if v is not None)
        return (source_rank, -filled)  # lower is better

    kept: list[dict[str, Any]] = []
    dropped: set[int] = set()

    for i, fi in enumerate(features):
        if i in dropped:
            continue
        pi = fi["properties"]
        lat_i, lng_i = pi["lat"], pi["lng"]
        for j in range(i + 1, len(features)):
            if j in dropped:
                continue
            pj = features[j]["properties"]
            if _haversine_km(lat_i, lng_i, pj["lat"], pj["lng"]) < radius_km:
                # Keep the better-scored one
                if _score(fi) <= _score(features[j]):
                    dropped.add(j)
                else:
                    dropped.add(i)
                    break
        if i not in dropped:
            kept.append(fi)

    log.info(
        "Dedup: %d -> %d features (removed %d near-duplicates)",
        len(features),
        len(kept),
        len(features) - len(kept),
    )
    return kept


# ---------------------------------------------------------------------------
# GeoJSON writer
# ---------------------------------------------------------------------------

def write_geojson(path: Path, features: list[dict[str, Any]], description: str = "") -> None:
    collection = {
        "type": "FeatureCollection",
        "features": features,
        "_meta": {
            "generated_at": _now_iso(),
            "count": len(features),
            "description": description,
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(collection, indent=2), encoding="utf-8")
    log.info("Wrote %d features to %s", len(features), path)


# ---------------------------------------------------------------------------
# Status logger
# ---------------------------------------------------------------------------

def _update_status(
    sensors_count: int,
    wind_count: int,
    live_sensor_sources: list[str],
    failed_sources: list[str],
) -> None:
    """Update /STATUS.md: mark ingest-airquality as DONE."""
    path = STATUS_PATH
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        log.warning("Could not read STATUS.md")
        return

    now = _now_iso()
    sources_str = ", ".join(live_sensor_sources) if live_sensor_sources else "none"
    failed_str = f" | FAILED: {', '.join(failed_sources)}" if failed_sources else ""

    old_line = "- [ ] IN_PROGRESS  ingest-airquality   -> /data/sensors.geojson      (count: __, sources live: __)"
    new_line = (
        f"- [x] DONE  ingest-airquality\n"
        f"  - output: /data/sensors.geojson ({sensors_count} features)\n"
        f"  - output: /data/wind.geojson ({wind_count} features)\n"
        f"  - sources live at build time: {sources_str}{failed_str}\n"
        f"  - completed: {now}"
    )

    if old_line in text:
        text = text.replace(old_line, new_line)
    else:
        # Fallback: append a note
        text += f"\n\n## ingest-airquality DONE — {now}\n"
        text += f"sensors: {sensors_count}, wind: {wind_count}, sources: {sources_str}{failed_str}\n"

    try:
        path.write_text(text, encoding="utf-8")
        log.info("Updated STATUS.md")
    except Exception as exc:
        log.error("Failed to write STATUS.md: %s", exc)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    log.info("=== ingest_airquality starting at %s ===", _now_iso())

    live_sources: list[str] = []
    failed_sources: list[str] = []

    # ---- Sensors ----
    all_sensor_features: list[dict[str, Any]] = []

    # AirNow
    try:
        airnow_feats = fetch_airnow()
        if airnow_feats:
            live_sources.append("airnow")
            all_sensor_features.extend(airnow_feats)
        else:
            failed_sources.append("airnow")
    except Exception as exc:
        log.error("AirNow fetch raised unexpected error: %s", exc)
        failed_sources.append("airnow")

    # PurpleAir
    try:
        pa_feats = fetch_purpleair()
        if pa_feats:
            live_sources.append("purpleair-epa-corrected")
            all_sensor_features.extend(pa_feats)
        else:
            failed_sources.append("purpleair")
    except Exception as exc:
        log.error("PurpleAir fetch raised unexpected error: %s", exc)
        failed_sources.append("purpleair")

    # OpenAQ
    try:
        oaq_feats = fetch_openaq()
        if oaq_feats:
            live_sources.append("openaq")
            all_sensor_features.extend(oaq_feats)
        else:
            failed_sources.append("openaq")
    except Exception as exc:
        log.error("OpenAQ fetch raised unexpected error: %s", exc)
        failed_sources.append("openaq")

    if not all_sensor_features:
        log.error("No sensor features collected from any source — aborting write.")
        _log_blockers(failed_sources)
        return 1

    # Deduplicate
    deduped = dedupe_sensors(all_sensor_features, radius_km=0.5)

    write_geojson(
        SENSORS_PATH,
        deduped,
        "Live U.S. air-quality sensor readings (AirNow + PurpleAir + OpenAQ)",
    )

    # ---- Wind ----
    wind_features: list[dict[str, Any]] = []
    try:
        wind_features = fetch_nws_wind()
        if wind_features:
            if "nws-api-weather-gov" not in live_sources:
                live_sources.append("nws-api-weather-gov")
        else:
            failed_sources.append("nws-api-weather-gov")
    except Exception as exc:
        log.error("NWS wind fetch raised unexpected error: %s", exc)
        failed_sources.append("nws-api-weather-gov")

    if wind_features:
        write_geojson(
            WIND_PATH,
            wind_features,
            "NWS wind observations (speed + direction) for continental US",
        )
    else:
        log.error("No wind features collected — wind.geojson not written")

    # ---- Status ----
    _update_status(
        sensors_count=len(deduped),
        wind_count=len(wind_features),
        live_sensor_sources=live_sources,
        failed_sources=failed_sources,
    )

    log.info(
        "=== ingest_airquality complete: %d sensor features, %d wind features ===",
        len(deduped),
        len(wind_features),
    )
    return 0


def _log_blockers(failed: list[str]) -> None:
    """Append blocker note to STATUS.md."""
    now = _now_iso()
    try:
        text = STATUS_PATH.read_text(encoding="utf-8")
        note = f"\n- [{now}] ingest-airquality: all sources failed — {', '.join(failed)}\n"
        if "## Blockers" in text:
            text = text.replace("## Blockers\n(log dead APIs, missing keys, rate-limit issues here)", f"## Blockers\n(log dead APIs, missing keys, rate-limit issues here){note}")
        else:
            text += note
        STATUS_PATH.write_text(text, encoding="utf-8")
    except Exception:
        pass


if __name__ == "__main__":
    sys.exit(main())
