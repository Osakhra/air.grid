"""
geo_matcher.py — Phase 2 geo-spatial join script for air.grid.

Produces two derived join tables:
  /data/joins/school_exposure.geojson
  /data/joins/facility_demographics.geojson

Parameters (edit defaults here):
  FACILITY_RADIUS_M = 10_000   # metres — facilities within this radius of a school
  FACILITY_TOP_N    = 5        # keep the N nearest facilities within radius
  SENSOR_RADIUS_M   = 50_000  # metres — nearest sensor within this radius

Distance method:
  Uses scipy.spatial.cKDTree on a scaled Euclidean approximation valid at mid-latitudes:
  - Convert lat/lng (decimal degrees) to radians.
  - Scale lng by cos(mean_lat) to correct for longitude compression.
  - Tree distances are in radians; multiply by EARTH_RADIUS_M to get metres.
  This approximation is accurate to ~0.1 % for the continental US and is far faster
  than full haversine queries across 100k+ points.

Run:
  python etl/geo_matcher.py

Idempotent: safe to re-run; overwrites output files.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
from scipy.spatial import cKDTree

# ---------------------------------------------------------------------------
# Parameters
# ---------------------------------------------------------------------------
FACILITY_RADIUS_M: float = 10_000.0   # metres; facilities within this distance of a school
FACILITY_TOP_N: int = 5               # max nearest facilities to return per school
SENSOR_RADIUS_M: float = 50_000.0     # metres; sensor search radius
EARTH_RADIUS_M: float = 6_371_000.0   # mean Earth radius in metres
SOURCE_TAG: str = "geo-matcher-2026-06-01"

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
DATA_DIR = Path("C:/Projects/air.grid/data")
JOINS_DIR = DATA_DIR / "joins"

INPUT_PATHS = {
    "facilities": DATA_DIR / "facilities.geojson",
    "schools": DATA_DIR / "schools.geojson",
    "sensors": DATA_DIR / "sensors.geojson",
    "demographics": DATA_DIR / "demographics.geojson",
    "wind": DATA_DIR / "wind.geojson",
}

OUTPUT_SCHOOL_EXPOSURE = JOINS_DIR / "school_exposure.geojson"
OUTPUT_FACILITY_DEMOGRAPHICS = JOINS_DIR / "facility_demographics.geojson"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _log(msg: str) -> None:
    print(f"[geo_matcher] {msg}", flush=True)


def _validate_inputs() -> None:
    """Verify every input file exists; abort loudly if any is missing."""
    missing = [name for name, path in INPUT_PATHS.items() if not path.exists()]
    if missing:
        _log(f"ERROR: Missing input files: {missing}")
        _log("Aborting — Phase 1 must be fully complete before running Phase 2.")
        sys.exit(1)
    _log("All input files present.")


def _load_geojson(path: Path) -> list[dict]:
    """Load a GeoJSON FeatureCollection and return its features list."""
    _log(f"Loading {path.name} ...")
    t0 = time.time()
    with open(path, "r", encoding="utf-8") as fh:
        fc = json.load(fh)
    if fc.get("type") != "FeatureCollection":
        _log(f"ERROR: {path.name} is not a FeatureCollection (type={fc.get('type')!r})")
        sys.exit(1)
    features = fc.get("features", [])
    _log(f"  Loaded {len(features):,} features in {time.time() - t0:.1f}s")
    return features


def _coords_to_scaled_rad(lats: np.ndarray, lngs: np.ndarray) -> np.ndarray:
    """
    Convert (lat, lng) decimal-degree arrays to a 2-column array in radians
    with longitude scaled by cos(mean_lat). This produces an Euclidean space
    where 1 unit ≈ 1 radian on the Earth's surface.

    Returns shape (N, 2): column 0 = lat_rad, column 1 = lng_rad * cos(mean_lat).
    """
    mean_lat_rad = np.deg2rad(np.mean(lats))
    lat_rad = np.deg2rad(lats)
    lng_rad = np.deg2rad(lngs) * math.cos(mean_lat_rad)
    return np.column_stack([lat_rad, lng_rad])


def _rad_to_metres(dist_rad: float | np.ndarray) -> float | np.ndarray:
    return dist_rad * EARTH_RADIUS_M


def _rad_upper_bound(radius_m: float) -> float:
    return radius_m / EARTH_RADIUS_M


def _bearing_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """
    Compute the forward bearing (degrees, 0=N, 90=E) from point 1 to point 2.
    Uses the planar approximation (fine for <50 km distances).
    """
    dlat = lat2 - lat1
    # correct for longitude compression at the mean latitude
    mean_lat = math.radians((lat1 + lat2) / 2.0)
    dlng = (lng2 - lng1) * math.cos(mean_lat)
    bearing = math.degrees(math.atan2(dlng, dlat)) % 360.0
    return bearing


def _is_downwind(
    facility_lat: float,
    facility_lng: float,
    school_lat: float,
    school_lng: float,
    wind_dir_deg: float,
    tolerance_deg: float = 45.0,
) -> bool:
    """
    Return True if the school is downwind of the facility given the wind direction.

    Meteorological wind direction: the direction FROM which the wind blows.
    Downwind direction = wind_dir_deg + 180° (where the wind is going).

    We compute the bearing from facility to school and check whether it falls
    within ±tolerance_deg of the downwind direction.
    """
    bearing_fac_to_school = _bearing_deg(
        facility_lat, facility_lng, school_lat, school_lng
    )
    downwind_dir = (wind_dir_deg + 180.0) % 360.0
    diff = abs((bearing_fac_to_school - downwind_dir + 180.0) % 360.0 - 180.0)
    return diff <= tolerance_deg


# ---------------------------------------------------------------------------
# Build school_exposure
# ---------------------------------------------------------------------------

def build_school_exposure(
    schools: list[dict],
    facilities: list[dict],
    sensors: list[dict],
    wind_features: list[dict],
) -> list[dict]:
    """
    For each school: find nearest N facilities within FACILITY_RADIUS_M,
    nearest sensor within SENSOR_RADIUS_M, and compute is_downwind flag.
    Returns a list of GeoJSON Feature dicts.
    """
    _log("Building school_exposure join ...")

    # ---- Extract facility coordinates and properties -----------------------
    _log("  Extracting facility coordinate arrays ...")
    fac_lats = np.zeros(len(facilities), dtype=np.float64)
    fac_lngs = np.zeros(len(facilities), dtype=np.float64)
    for i, f in enumerate(facilities):
        p = f["properties"]
        fac_lats[i] = p["lat"]
        fac_lngs[i] = p["lng"]

    fac_coords = _coords_to_scaled_rad(fac_lats, fac_lngs)
    _log(f"  Building cKDTree for {len(facilities):,} facilities ...")
    fac_tree = cKDTree(fac_coords)

    # ---- Extract sensor coordinates ----------------------------------------
    _log("  Extracting sensor coordinate arrays ...")
    sen_lats = np.zeros(len(sensors), dtype=np.float64)
    sen_lngs = np.zeros(len(sensors), dtype=np.float64)
    for i, s in enumerate(sensors):
        p = s["properties"]
        sen_lats[i] = p["lat"]
        sen_lngs[i] = p["lng"]

    sen_coords = _coords_to_scaled_rad(sen_lats, sen_lngs)
    _log(f"  Building cKDTree for {len(sensors):,} sensors ...")
    sen_tree = cKDTree(sen_coords)

    # ---- Extract wind grid -------------------------------------------------
    wind_lats = np.array([f["properties"]["lat"] for f in wind_features], dtype=np.float64)
    wind_lngs = np.array([f["properties"]["lng"] for f in wind_features], dtype=np.float64)
    wind_coords = _coords_to_scaled_rad(wind_lats, wind_lngs)
    wind_tree = cKDTree(wind_coords) if len(wind_features) > 0 else None

    # ---- Pre-build facility ID and emissions arrays (avoid per-query dict lookups) ---
    fac_ids = [f["properties"]["id"] for f in facilities]
    fac_emissions = np.array(
        [f["properties"].get("emissions_value") or 0.0 for f in facilities],
        dtype=np.float64,
    )

    # Compute scale factor once (cos of mean lat across all facilities)
    mean_fac_lat_rad = math.radians(float(np.mean(fac_lats)))
    mean_sen_lat_rad = math.radians(float(np.mean(sen_lats)))
    mean_wind_lat_rad = (
        math.radians(float(np.mean(wind_lats))) if len(wind_features) > 0 else 0.0
    )

    fac_upper = _rad_upper_bound(FACILITY_RADIUS_M)
    sen_upper = _rad_upper_bound(SENSOR_RADIUS_M)

    # ---- Process each school ------------------------------------------------
    features_out: list[dict] = []
    n_schools = len(schools)
    _log(f"  Processing {n_schools:,} schools ...")
    t0 = time.time()

    for idx, school in enumerate(schools):
        if idx > 0 and idx % 10_000 == 0:
            elapsed = time.time() - t0
            rate = idx / elapsed
            remaining = (n_schools - idx) / rate
            _log(f"    {idx:,}/{n_schools:,} schools processed "
                 f"({elapsed:.0f}s elapsed, ~{remaining:.0f}s remaining)")

        sp = school["properties"]
        slat = sp["lat"]
        slng = sp["lng"]

        # Query point in scaled-radian space
        slat_rad = math.radians(slat)
        slng_rad = math.radians(slng) * math.cos(mean_fac_lat_rad)
        q_fac = np.array([[slat_rad, slng_rad]])

        # Nearest facilities within radius
        dists_rad, indices = fac_tree.query(
            q_fac, k=FACILITY_TOP_N, distance_upper_bound=fac_upper, workers=1
        )
        dists_rad = dists_rad[0]
        indices = indices[0]

        # Filter out "no result" sentinels (index == len(facilities) when no neighbour found)
        valid_mask = indices < len(facilities)
        valid_indices = indices[valid_mask]
        valid_dists_rad = dists_rad[valid_mask]

        nearest_facility_ids: list[str] = [fac_ids[i] for i in valid_indices]
        nearest_facility_distances_m: list[float] = [
            round(float(_rad_to_metres(d)), 2) for d in valid_dists_rad
        ]
        max_emissions_nearby: float | None = (
            float(np.max(fac_emissions[valid_indices])) if len(valid_indices) > 0 else None
        )

        # Nearest sensor within radius
        slat_rad_s = math.radians(slat)
        slng_rad_s = math.radians(slng) * math.cos(mean_sen_lat_rad)
        q_sen = np.array([[slat_rad_s, slng_rad_s]])
        sen_dist_rad, sen_idx = sen_tree.query(q_sen, k=1, distance_upper_bound=sen_upper)
        sen_dist_rad = float(sen_dist_rad[0])
        sen_idx = int(sen_idx[0])

        nearest_aqi: float | None = None
        nearest_sensor_id: str | None = None
        nearest_sensor_distance_m: float | None = None

        if sen_idx < len(sensors):
            nearest_sensor_distance_m = round(float(_rad_to_metres(sen_dist_rad)), 2)
            sen_props = sensors[sen_idx]["properties"]
            nearest_sensor_id = sen_props["id"]
            aqi_val = sen_props.get("aqi")
            nearest_aqi = float(aqi_val) if aqi_val is not None else None

        # is_downwind: check if school is downwind of any nearby facility
        is_downwind_flag: bool | None = None
        if len(valid_indices) > 0 and wind_tree is not None:
            # Find nearest wind grid point to the school
            slat_rad_w = math.radians(slat)
            slng_rad_w = math.radians(slng) * math.cos(mean_wind_lat_rad)
            q_wind = np.array([[slat_rad_w, slng_rad_w]])
            _, wind_idx = wind_tree.query(q_wind, k=1)
            wind_idx = int(wind_idx[0])
            wind_dir = float(wind_features[wind_idx]["properties"]["dir_deg"])

            # Check if ANY nearby facility puts the school downwind
            is_downwind_flag = False
            for fi in valid_indices:
                fac_props = facilities[fi]["properties"]
                if _is_downwind(
                    fac_props["lat"],
                    fac_props["lng"],
                    slat,
                    slng,
                    wind_dir,
                ):
                    is_downwind_flag = True
                    break

        feature: dict[str, Any] = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [slng, slat],
            },
            "properties": {
                "school_id": sp["id"],
                "school_name": sp["name"],
                "lat": slat,
                "lng": slng,
                "nearest_facility_ids": nearest_facility_ids,
                "nearest_facility_distances_m": nearest_facility_distances_m,
                "max_emissions_nearby": max_emissions_nearby,
                "nearest_aqi": nearest_aqi,
                "nearest_sensor_id": nearest_sensor_id,
                "nearest_sensor_distance_m": nearest_sensor_distance_m,
                "is_downwind": is_downwind_flag,
                "source": SOURCE_TAG,
            },
        }
        features_out.append(feature)

    elapsed = time.time() - t0
    _log(f"  school_exposure: {len(features_out):,} features built in {elapsed:.1f}s")
    return features_out


# ---------------------------------------------------------------------------
# Build facility_demographics
# ---------------------------------------------------------------------------

def build_facility_demographics(
    facilities: list[dict],
    demographics: list[dict],
) -> list[dict]:
    """
    For each facility: find the nearest Census tract centroid (no radius limit).
    Copy geoid, population, median_income, pct_minority from that tract.
    Returns a list of GeoJSON Feature dicts.
    """
    _log("Building facility_demographics join ...")

    # ---- Extract demographics coordinates -----------------------------------
    _log(f"  Extracting {len(demographics):,} demographic tract coordinates ...")
    dem_lats = np.zeros(len(demographics), dtype=np.float64)
    dem_lngs = np.zeros(len(demographics), dtype=np.float64)
    for i, d in enumerate(demographics):
        p = d["properties"]
        dem_lats[i] = p["lat"]
        dem_lngs[i] = p["lng"]

    dem_coords = _coords_to_scaled_rad(dem_lats, dem_lngs)
    _log(f"  Building cKDTree for {len(demographics):,} tract centroids ...")
    dem_tree = cKDTree(dem_coords)

    mean_dem_lat_rad = math.radians(float(np.mean(dem_lats)))

    # ---- Process each facility ---------------------------------------------
    features_out: list[dict] = []
    n_fac = len(facilities)
    _log(f"  Processing {n_fac:,} facilities ...")
    t0 = time.time()

    # Batch all facility query points at once for efficiency
    _log("  Extracting facility coordinate arrays ...")
    fac_lats = np.zeros(n_fac, dtype=np.float64)
    fac_lngs = np.zeros(n_fac, dtype=np.float64)
    for i, f in enumerate(facilities):
        p = f["properties"]
        fac_lats[i] = p["lat"]
        fac_lngs[i] = p["lng"]

    fac_lat_rad = np.deg2rad(fac_lats)
    fac_lng_rad = np.deg2rad(fac_lngs) * math.cos(mean_dem_lat_rad)
    fac_coords = np.column_stack([fac_lat_rad, fac_lng_rad])

    _log("  Querying cKDTree (batch k=1 for all facilities) ...")
    t_query = time.time()
    _, dem_indices = dem_tree.query(fac_coords, k=1, workers=-1)
    _log(f"  Tree query done in {time.time() - t_query:.1f}s")

    _log("  Building output features ...")
    for i, facility in enumerate(facilities):
        if i > 0 and i % 50_000 == 0:
            elapsed = time.time() - t0
            rate = i / elapsed
            remaining = (n_fac - i) / rate
            _log(f"    {i:,}/{n_fac:,} facilities processed "
                 f"({elapsed:.0f}s elapsed, ~{remaining:.0f}s remaining)")

        fp = facility["properties"]
        dem_idx = int(dem_indices[i])
        dp = demographics[dem_idx]["properties"]

        feature: dict[str, Any] = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [fp["lng"], fp["lat"]],
            },
            "properties": {
                "facility_id": fp["id"],
                "facility_name": fp["name"],
                "lat": fp["lat"],
                "lng": fp["lng"],
                "geoid": dp["geoid"],
                "population": int(dp["population"]),
                "median_income": dp.get("median_income"),
                "pct_minority": float(dp["pct_minority"]),
                "source": SOURCE_TAG,
            },
        }
        features_out.append(feature)

    elapsed = time.time() - t0
    _log(f"  facility_demographics: {len(features_out):,} features built in {elapsed:.1f}s")
    return features_out


# ---------------------------------------------------------------------------
# Write GeoJSON FeatureCollection
# ---------------------------------------------------------------------------

def _write_geojson(features: list[dict], path: Path) -> None:
    fc = {
        "type": "FeatureCollection",
        "features": features,
    }
    _log(f"Writing {path} ({len(features):,} features) ...")
    t0 = time.time()
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))
    size_mb = path.stat().st_size / (1024 * 1024)
    _log(f"  Wrote {size_mb:.1f} MB in {time.time() - t0:.1f}s")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    overall_t0 = time.time()
    _log("=" * 60)
    _log("geo_matcher.py — Phase 2 spatial join")
    _log(f"Parameters: FACILITY_RADIUS_M={FACILITY_RADIUS_M:,.0f}  "
         f"FACILITY_TOP_N={FACILITY_TOP_N}  "
         f"SENSOR_RADIUS_M={SENSOR_RADIUS_M:,.0f}")
    _log("=" * 60)

    # 1. Validate inputs
    _validate_inputs()

    # 2. Create output directory
    JOINS_DIR.mkdir(parents=True, exist_ok=True)
    _log(f"Output directory: {JOINS_DIR}")

    # 3. Load all input data
    facilities = _load_geojson(INPUT_PATHS["facilities"])
    schools = _load_geojson(INPUT_PATHS["schools"])
    sensors = _load_geojson(INPUT_PATHS["sensors"])
    demographics = _load_geojson(INPUT_PATHS["demographics"])
    wind_features = _load_geojson(INPUT_PATHS["wind"])

    # 4. Build school_exposure
    school_exposure_features = build_school_exposure(
        schools, facilities, sensors, wind_features
    )

    # 5. Write school_exposure
    _write_geojson(school_exposure_features, OUTPUT_SCHOOL_EXPOSURE)
    del school_exposure_features  # free memory before facilities join

    # 6. Build facility_demographics
    facility_demographics_features = build_facility_demographics(
        facilities, demographics
    )

    # 7. Write facility_demographics
    _write_geojson(facility_demographics_features, OUTPUT_FACILITY_DEMOGRAPHICS)

    total = time.time() - overall_t0
    _log("=" * 60)
    _log(f"geo_matcher complete in {total:.1f}s")
    _log(f"  school_exposure    -> {OUTPUT_SCHOOL_EXPOSURE}")
    _log(f"  facility_demographics -> {OUTPUT_FACILITY_DEMOGRAPHICS}")
    _log("=" * 60)


if __name__ == "__main__":
    main()
