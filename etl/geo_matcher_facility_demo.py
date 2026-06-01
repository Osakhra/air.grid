"""
geo_matcher_facility_demo.py
Phase 2 geo-matcher: for each facility, find the nearest Census tract centroid
and attach its demographic data to produce /data/joins/facility_demographics.geojson.

Algorithm
---------
- Load demographics.geojson once; build a scipy cKDTree on scaled-radian coordinates
  (lng * cos(mean_lat_rad)) to approximate great-circle distance with a fast Euclidean
  index search. No reprojection library is required.
- Load facilities.geojson once; batch-query the tree with k=1.
- Write one GeoJSON FeatureCollection to /data/joins/facility_demographics.geojson.

Output schema (per schema.contract.json joins/facility_demographics):
  facility_id   string   required
  facility_name string   required
  lat           number   required
  lng           number   required
  geoid         string   required  11-digit Census FIPS of nearest tract centroid
  population    integer  required
  median_income number   nullable  null if Census-suppressed
  pct_minority  number   required  fraction 0.0-1.0
  source        string   required  "geo-matcher-2026-06-01"

Defaults / parameters
---------------------
  NEAREST_K = 1          (nearest-centroid join; no radius filter)
  SOURCE_TAG = "geo-matcher-2026-06-01"

Usage
-----
  python /etl/geo_matcher_facility_demo.py

Dependencies
------------
  pip install scipy numpy
"""

from __future__ import annotations

import json
import logging
import math
import os
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path("C:/Projects/air.grid")
FACILITIES_PATH = PROJECT_ROOT / "public" / "data" / "facilities.geojson"
DEMOGRAPHICS_PATH = PROJECT_ROOT / "public" / "data" / "demographics.geojson"
OUTPUT_DIR = PROJECT_ROOT / "public" / "data" / "joins"
OUTPUT_PATH = OUTPUT_DIR / "facility_demographics.geojson"

# ---------------------------------------------------------------------------
# Parameters
# ---------------------------------------------------------------------------
NEAREST_K: int = 1
SOURCE_TAG: str = "geo-matcher-2026-06-01"


def validate_inputs() -> None:
    """Stop loudly if required input files are missing."""
    for path in (FACILITIES_PATH, DEMOGRAPHICS_PATH):
        if not path.exists():
            log.error("Required input file not found: %s", path)
            sys.exit(1)
    log.info("Input files validated: %s, %s", FACILITIES_PATH, DEMOGRAPHICS_PATH)


def load_demographics() -> tuple:
    """
    Load demographics.geojson and return parallel numpy float64 arrays.

    Returns
    -------
    (demo_lats, demo_lngs, demo_geoids, demo_populations, demo_incomes,
     demo_pct_minority)
    """
    import numpy as np

    log.info("Loading demographics: %s", DEMOGRAPHICS_PATH)
    with open(DEMOGRAPHICS_PATH, "r", encoding="utf-8") as fh:
        fc = json.load(fh)

    features = fc.get("features", [])
    if not features:
        log.error("demographics.geojson is empty or has no features")
        sys.exit(1)

    n = len(features)
    demo_lats = np.empty(n, dtype=np.float64)
    demo_lngs = np.empty(n, dtype=np.float64)
    demo_geoids: list[str] = []
    demo_populations = np.empty(n, dtype=np.int64)
    demo_incomes: list[float | None] = []
    demo_pct_minority = np.empty(n, dtype=np.float64)

    for i, feat in enumerate(features):
        props = feat["properties"]
        demo_lats[i] = float(props["lat"])
        demo_lngs[i] = float(props["lng"])
        demo_geoids.append(str(props["geoid"]))
        demo_populations[i] = int(props["population"])
        inc = props.get("median_income")
        demo_incomes.append(float(inc) if inc is not None else None)
        demo_pct_minority[i] = float(props["pct_minority"])

    log.info("Loaded %d Census tract centroids", n)
    return (
        demo_lats,
        demo_lngs,
        demo_geoids,
        demo_populations,
        demo_incomes,
        demo_pct_minority,
    )


def build_kdtree(demo_lats, demo_lngs):
    """
    Build a cKDTree on scaled-radian coordinates.

    Coordinate transform:
      x = lat_rad
      y = lng_rad * cos(mean_lat_rad)

    This makes 1 unit in both dimensions equal to approximately 1 radian
    of arc length (Earth radius cancels in nearest-neighbour search).
    """
    import numpy as np
    from scipy.spatial import cKDTree

    mean_lat_rad = math.radians(float(demo_lats.mean()))
    cos_mean_lat = math.cos(mean_lat_rad)

    lats_rad = np.radians(demo_lats)
    lngs_rad = np.radians(demo_lngs) * cos_mean_lat

    coords = np.column_stack([lats_rad, lngs_rad])
    tree = cKDTree(coords)
    log.info("cKDTree built (mean_lat_rad=%.4f, cos=%.4f)", mean_lat_rad, cos_mean_lat)
    return tree, mean_lat_rad, cos_mean_lat


def load_facilities():
    """
    Load facilities.geojson and return parallel arrays.

    Returns
    -------
    (fac_lats, fac_lngs, fac_ids, fac_names)
    """
    import numpy as np

    log.info("Loading facilities: %s", FACILITIES_PATH)
    with open(FACILITIES_PATH, "r", encoding="utf-8") as fh:
        fc = json.load(fh)

    features = fc.get("features", [])
    if not features:
        log.error("facilities.geojson is empty or has no features")
        sys.exit(1)

    n = len(features)
    fac_lats = np.empty(n, dtype=np.float64)
    fac_lngs = np.empty(n, dtype=np.float64)
    fac_ids: list[str] = []
    fac_names: list[str] = []

    for i, feat in enumerate(features):
        props = feat["properties"]
        fac_lats[i] = float(props["lat"])
        fac_lngs[i] = float(props["lng"])
        fac_ids.append(str(props["id"]))
        fac_names.append(str(props["name"]))

    log.info("Loaded %d facilities", n)
    return fac_lats, fac_lngs, fac_ids, fac_names


def query_tree(tree, fac_lats, fac_lngs, cos_mean_lat):
    """
    Batch-query the cKDTree for the nearest Census tract centroid
    for every facility.

    Returns
    -------
    indices : np.ndarray, shape (n_facilities,)
    """
    import numpy as np

    fac_lats_rad = np.radians(fac_lats)
    fac_lngs_rad = np.radians(fac_lngs) * cos_mean_lat
    fac_coords = np.column_stack([fac_lats_rad, fac_lngs_rad])

    _distances, indices = tree.query(fac_coords, k=NEAREST_K, workers=-1)
    log.info("KD-tree query complete for %d facilities", len(fac_lats))
    return indices


def build_geojson(
    fac_lats,
    fac_lngs,
    fac_ids: list[str],
    fac_names: list[str],
    indices,
    demo_geoids: list[str],
    demo_populations,
    demo_incomes: list,
    demo_pct_minority,
) -> dict:
    """Construct the GeoJSON FeatureCollection from parallel arrays."""
    features = []
    n = len(fac_ids)
    for i in range(n):
        di = int(indices[i])
        lat = float(fac_lats[i])
        lng = float(fac_lngs[i])
        inc = demo_incomes[di]
        feature = {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lng, lat]},
            "properties": {
                "facility_id": fac_ids[i],
                "facility_name": fac_names[i],
                "lat": lat,
                "lng": lng,
                "geoid": demo_geoids[di],
                "population": int(demo_populations[di]),
                "median_income": float(inc) if inc is not None else None,
                "pct_minority": float(demo_pct_minority[di]),
                "source": SOURCE_TAG,
            },
        }
        features.append(feature)
    return {"type": "FeatureCollection", "features": features}


def write_output(fc: dict) -> None:
    """Write the FeatureCollection to OUTPUT_PATH (idempotent — overwrites)."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    log.info("Writing %d features to %s", len(fc["features"]), OUTPUT_PATH)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))
    size_mb = OUTPUT_PATH.stat().st_size / 1_048_576
    log.info("Wrote %.1f MB to %s", size_mb, OUTPUT_PATH)


def main() -> None:
    log.info("=== geo_matcher_facility_demo start ===")
    log.info("NEAREST_K=%d  SOURCE_TAG=%s", NEAREST_K, SOURCE_TAG)

    validate_inputs()

    # 1. Load demographics arrays
    (
        demo_lats,
        demo_lngs,
        demo_geoids,
        demo_populations,
        demo_incomes,
        demo_pct_minority,
    ) = load_demographics()

    # 2. Build KD-tree
    tree, _mean_lat_rad, cos_mean_lat = build_kdtree(demo_lats, demo_lngs)

    # 3. Load facilities arrays
    fac_lats, fac_lngs, fac_ids, fac_names = load_facilities()

    # 4. Batch nearest-neighbour query
    indices = query_tree(tree, fac_lats, fac_lngs, cos_mean_lat)

    # 5. Build GeoJSON
    fc = build_geojson(
        fac_lats,
        fac_lngs,
        fac_ids,
        fac_names,
        indices,
        demo_geoids,
        demo_populations,
        demo_incomes,
        demo_pct_minority,
    )

    # 6. Write output
    write_output(fc)

    log.info("=== geo_matcher_facility_demo DONE: %d features ===", len(fc["features"]))


if __name__ == "__main__":
    main()
