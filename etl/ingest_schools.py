"""
ingest_schools.py — Download and normalize US school/college data to /data/schools.geojson

Sources:
  K-12:    NCES EDGE Geocode (2022-23) — school locations + names (102 k public schools)
           NCES CCD Membership (2022-23) — total enrollment by school
  College: IPEDS HD2022 — institutional directory (lat/lng, name)
           IPEDS EFFY2022 — 12-month unduplicated enrollment

Output:
  /data/schools.geojson — GeoJSON FeatureCollection, one Point per school/campus

Schema: /data/schema.contract.json -> tables.schools
Idempotent: re-running overwrites /data/schools.geojson with fresh data.

Coordinate format (EDGE geocode TXT, pipe-delimited, no header):
  col 0: NCESSCH (12-digit string)
  col 1: LEAID
  col 2: NAME (school name)
  col 3: FIPST
  col 4: STREET
  col 5: CITY
  col 6: STATE
  col 7: ZIP
  col 8: ? (state agency no)
  col 9: COUNTY_CODE
  col 10: COUNTY
  col 11: LOCALE_CODE
  col 12: LATITUDE (decimal degrees WGS84)
  col 13: LONGITUDE (decimal degrees WGS84)
  ...remaining cols: metro area, locale flags, congressional district, etc.
"""

from __future__ import annotations

import csv
import io
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "public" / "data"
OUTPUT_FILE = DATA_DIR / "schools.geojson"

# US bounding box filter (lat 17-72, lng -180 to -65)
LAT_MIN, LAT_MAX = 17.0, 72.0
LNG_MIN, LNG_MAX = -180.0, -65.0

# Request settings
REQUEST_TIMEOUT = 180  # seconds
REQUEST_HEADERS = {
    "User-Agent": "air.grid/1.0 data-ingest (contact: evyosakhra@gmail.com)"
}

# --- K-12 source URLs ---
# NCES EDGE geocode file (2022-23): pipe-delimited TXT + shapefile, no header
# Confirmed 200 OK, ~30 MB ZIP, 102 k schools
NCES_GEOCODE_URL = (
    "https://nces.ed.gov/programs/edge/data/EDGE_GEOCODE_PUBLICSCH_2223.zip"
)
# NCES CCD school membership (2022-23): disaggregated by grade/race/sex, ~208 MB
# Contains TOTAL_INDICATOR or grade=00 rows for school-level totals
CCD_MEMBERSHIP_URL = (
    "https://nces.ed.gov/ccd/data/zip/ccd_sch_052_2223_l_1a_083023.zip"
)

# --- College source URLs ---
# IPEDS HD2022: institutional directory with lat/lng, ~1 MB
IPEDS_HD_URL = "https://nces.ed.gov/ipeds/datacenter/data/HD2022.zip"
# IPEDS EFFY2022: 12-month unduplicated enrollment, ~6 MB
IPEDS_EFFY_URL = "https://nces.ed.gov/ipeds/datacenter/data/EFFY2022.zip"

BUILD_TS = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# EDGE geocode column indices (0-based, pipe-delimited, no header)
EDGE_COL_NCESSCH = 0
EDGE_COL_NAME = 2
EDGE_COL_LAT = 12
EDGE_COL_LON = 13


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def download_zip(url: str, label: str) -> bytes:
    """Stream-download a ZIP and return raw bytes. Raises RuntimeError on failure."""
    print(f"  Downloading {label}...", flush=True)
    print(f"    URL: {url}", flush=True)
    resp = requests.get(
        url, headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT, stream=True
    )
    if resp.status_code != 200:
        raise RuntimeError(
            f"HTTP {resp.status_code} fetching {label}: {url}"
        )
    chunks: list[bytes] = []
    total = 0
    mb_logged = 0
    for chunk in resp.iter_content(chunk_size=1 << 17):  # 128 KB
        chunks.append(chunk)
        total += len(chunk)
        mb_now = total // (10 << 20)
        if mb_now > mb_logged:
            mb_logged = mb_now
            print(f"    ... {total // (1 << 20)} MB received", flush=True)
    data = b"".join(chunks)
    print(f"  Done — {len(data) / (1 << 20):.1f} MB", flush=True)
    return data


def safe_float(val: str | None) -> float | None:
    """Return float or None for blank/non-numeric strings."""
    if val is None:
        return None
    v = val.strip()
    if not v or v in ("-", "N", "NA", "NULL", ".", "M", "-1", "-2"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def safe_int(val: str | None) -> int | None:
    """Return int or None for blank/non-numeric strings."""
    if val is None:
        return None
    v = val.strip()
    if not v or v in ("-", "N", "NA", "NULL", ".", "M", "-1", "-2"):
        return None
    try:
        return int(float(v))
    except (ValueError, OverflowError):
        return None


def in_us_bbox(lat: float, lng: float) -> bool:
    return LAT_MIN <= lat <= LAT_MAX and LNG_MIN <= lng <= LNG_MAX


def make_feature(
    feat_id: str,
    name: str,
    lat: float,
    lng: float,
    level: str,
    enrollment: int | None,
    source: str,
) -> dict[str, Any]:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lng, lat]},
        "properties": {
            "id": feat_id,
            "name": name,
            "lat": lat,
            "lng": lng,
            "level": level,
            "enrollment": enrollment,
            "source": source,
            "build_ts": BUILD_TS,
        },
    }


# ---------------------------------------------------------------------------
# K-12: NCES EDGE Geocode (locations + names)
# ---------------------------------------------------------------------------


def parse_edge_geocode(zip_bytes: bytes) -> dict[str, dict[str, Any]]:
    """
    Parse EDGE_GEOCODE_PUBLICSCH_2223.TXT (pipe-delimited, no header).

    Returns dict: {ncessch: {"name": ..., "lat": ..., "lng": ...}}
    """
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    txt_name = next(
        (n for n in zf.namelist() if n.upper().endswith(".TXT") and "GEOCODE" in n.upper()),
        None,
    )
    if not txt_name:
        raise RuntimeError(
            f"Cannot find TXT file in EDGE geocode ZIP. Files: {zf.namelist()}"
        )
    print(f"  Reading: {txt_name}", flush=True)
    raw = zf.read(txt_name).decode("latin-1", errors="replace")

    schools: dict[str, dict[str, Any]] = {}
    skipped_bbox = 0
    skipped_coords = 0

    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        cols = line.split("|")
        if len(cols) < 14:
            continue
        ncessch = cols[EDGE_COL_NCESSCH].strip()
        if not ncessch:
            continue
        name = cols[EDGE_COL_NAME].strip()
        lat = safe_float(cols[EDGE_COL_LAT])
        lng = safe_float(cols[EDGE_COL_LON])

        if lat is None or lng is None:
            skipped_coords += 1
            continue
        if not in_us_bbox(lat, lng):
            skipped_bbox += 1
            continue

        schools[ncessch] = {"name": name, "lat": lat, "lng": lng}

    print(
        f"  EDGE geocode parsed: {len(schools):,} schools "
        f"(skipped no_coords={skipped_coords}, outside_bbox={skipped_bbox})",
        flush=True,
    )
    return schools


# ---------------------------------------------------------------------------
# K-12: CCD Membership (enrollment totals)
# ---------------------------------------------------------------------------


def parse_ccd_membership(zip_bytes: bytes) -> dict[str, int | None]:
    """
    Parse CCD school membership file to extract total enrollment per school.

    The membership file is disaggregated by grade, race/ethnicity, and sex.
    We want rows where GRADE='No Category Codes' (or equivalent) and RACE_ETHNICITY
    and SEX are also 'No Category Codes' — i.e., the school-level total.

    Returns dict: {ncessch: total_students}
    """
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
    if not csv_names:
        raise RuntimeError(f"No CSV in CCD membership ZIP. Files: {zf.namelist()}")
    csv_name = csv_names[0]
    print(f"  Reading: {csv_name}", flush=True)
    raw = zf.read(csv_name).decode("latin-1", errors="replace")

    reader = csv.DictReader(io.StringIO(raw))
    headers: list[str] | None = None
    id_col: str | None = None
    count_col: str | None = None
    grade_col: str | None = None
    race_col: str | None = None
    sex_col: str | None = None

    enrollment: dict[str, int | None] = {}
    rows_processed = 0

    for row in reader:
        if headers is None:
            headers = list(row.keys())
            # Resolve column names
            id_candidates = ["NCESSCH", "ncessch"]
            count_candidates = ["STUDENT_COUNT", "student_count", "MEMBERRACE", "memberrace"]
            grade_candidates = ["GRADE", "grade"]
            race_candidates = ["RACE_ETHNICITY", "race_ethnicity", "RACE", "race"]
            sex_candidates = ["SEX", "sex", "GENDER", "gender"]

            id_col = next((c for c in id_candidates if c in headers), None)
            count_col = next((c for c in count_candidates if c in headers), None)
            grade_col = next((c for c in grade_candidates if c in headers), None)
            race_col = next((c for c in race_candidates if c in headers), None)
            sex_col = next((c for c in sex_candidates if c in headers), None)

            if not id_col:
                raise RuntimeError(
                    f"No NCESSCH column found. Headers: {headers[:30]}"
                )
            if not count_col:
                print(
                    f"  WARNING: No student count column found. Headers: {headers[:30]}",
                    file=sys.stderr,
                )
                return {}

        # Filter to school-level total row:
        # GRADE = 'No Category Codes' (coded as specific value)
        # RACE_ETHNICITY = 'No Category Codes'
        # SEX = 'No Category Codes' (or 'Total')
        # NCES uses "No Category Codes" string for the aggregate row
        def is_total_row(colname: str | None, val_total: str = "No Category Codes") -> bool:
            if colname is None:
                return True
            val = row.get(colname, "").strip()
            return val in ("No Category Codes", "Total", "99", "-1", "")

        if not (is_total_row(grade_col) and is_total_row(race_col) and is_total_row(sex_col)):
            continue

        ncessch = row.get(id_col, "").strip()
        if not ncessch:
            continue

        count = safe_int(row.get(count_col))
        rows_processed += 1

        # Take max in case of duplicate totals
        existing = enrollment.get(ncessch)
        if ncessch not in enrollment or (
            count is not None and (existing is None or count > (existing or 0))
        ):
            enrollment[ncessch] = count

    print(
        f"  CCD membership: {len(enrollment):,} schools with enrollment data "
        f"(total rows processed: {rows_processed:,})",
        flush=True,
    )
    return enrollment


# ---------------------------------------------------------------------------
# College: IPEDS HD2022 (directory)
# ---------------------------------------------------------------------------


def parse_ipeds_hd(zip_bytes: bytes) -> dict[str, dict[str, Any]]:
    """
    Parse IPEDS HD2022 directory to get institution name, lat/lng, and metadata.

    Returns dict: {unitid: {"name": ..., "lat": ..., "lng": ..., "open": bool}}
    """
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    # HD2022 contains hd2022.csv (and possibly _rv.csv)
    csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
    # Prefer revised version if present
    rv_names = [n for n in csv_names if "_rv" in n.lower()]
    csv_name = rv_names[0] if rv_names else csv_names[0]
    print(f"  Reading: {csv_name}", flush=True)
    raw = zf.read(csv_name).decode("latin-1", errors="replace")

    reader = csv.DictReader(io.StringIO(raw))
    institutions: dict[str, dict[str, Any]] = {}
    skipped_closed = 0
    skipped_coords = 0
    skipped_bbox = 0

    for row in reader:
        unitid = row.get("UNITID", "").strip()
        if not unitid:
            continue

        # Skip institutions that have closed (CLOSEDAT != -2 means closed/unknown)
        close_val = row.get("CLOSEDAT", "").strip()
        # -2 = currently open in IPEDS coding
        if close_val not in ("-2", "", ".", "NA"):
            skipped_closed += 1
            continue

        name = row.get("INSTNM", "").strip()
        if not name:
            name = f"Institution {unitid}"

        lat = safe_float(row.get("LATITUDE"))
        lng = safe_float(row.get("LONGITUD"))

        if lat is None or lng is None:
            skipped_coords += 1
            continue
        if not in_us_bbox(lat, lng):
            skipped_bbox += 1
            continue

        institutions[unitid] = {"name": name, "lat": lat, "lng": lng}

    print(
        f"  IPEDS HD2022: {len(institutions):,} open institutions with valid coords "
        f"(skipped closed={skipped_closed}, no_coords={skipped_coords}, "
        f"outside_bbox={skipped_bbox})",
        flush=True,
    )
    return institutions


# ---------------------------------------------------------------------------
# College: IPEDS EFFY2022 (enrollment)
# ---------------------------------------------------------------------------


def parse_ipeds_effy(zip_bytes: bytes) -> dict[str, int | None]:
    """
    Parse IPEDS EFFY2022 12-month enrollment file.

    Filter to EFFYALEV=1, EFFYLEV=1 which is the total unduplicated headcount.

    Returns dict: {unitid: total_enrollment}
    """
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
    # Prefer _rv (revised) if present
    rv_names = [n for n in csv_names if "_rv" in n.lower()]
    csv_name = rv_names[0] if rv_names else csv_names[0]
    print(f"  Reading: {csv_name}", flush=True)
    raw = zf.read(csv_name).decode("latin-1", errors="replace")

    reader = csv.DictReader(io.StringIO(raw))
    enrollment: dict[str, int | None] = {}

    for row in reader:
        # EFFYALEV=1 (total, all levels), EFFYLEV=1 (total)
        effyalev = row.get("EFFYALEV", "").strip()
        effylev = row.get("EFFYLEV", "").strip()
        if effyalev != "1" or effylev != "1":
            continue
        unitid = row.get("UNITID", "").strip()
        if not unitid:
            continue
        count = safe_int(row.get("EFYTOTLT"))
        enrollment[unitid] = count

    print(f"  IPEDS EFFY2022: {len(enrollment):,} institutions with enrollment data", flush=True)
    return enrollment


# ---------------------------------------------------------------------------
# Validate output
# ---------------------------------------------------------------------------

REQUIRED_FIELDS = ("id", "name", "lat", "lng", "level", "source")
VALID_LEVELS = {"k12", "college"}


def validate_feature(feat: dict[str, Any], idx: int) -> list[str]:
    errors: list[str] = []
    props = feat.get("properties", {})
    for field in REQUIRED_FIELDS:
        v = props.get(field)
        if v is None or v == "":
            errors.append(f"Feature #{idx}: missing/empty required field '{field}'")
    level = props.get("level")
    if level not in VALID_LEVELS:
        errors.append(f"Feature #{idx}: invalid level {level!r} (must be 'k12' or 'college')")
    lat = props.get("lat")
    lng = props.get("lng")
    if isinstance(lat, float) and isinstance(lng, float):
        if not in_us_bbox(lat, lng):
            errors.append(f"Feature #{idx}: coords outside US bbox (lat={lat}, lng={lng})")
    geom = feat.get("geometry", {})
    if geom.get("type") != "Point":
        errors.append(f"Feature #{idx}: geometry type is not Point")
    coords = geom.get("coordinates", [])
    if len(coords) != 2:
        errors.append(f"Feature #{idx}: geometry coordinates malformed {coords}")
    return errors


def validate_output(features: list[dict[str, Any]]) -> None:
    print(f"\nValidating {len(features):,} features...", flush=True)
    all_errors: list[str] = []
    for i, feat in enumerate(features):
        errs = validate_feature(feat, i)
        all_errors.extend(errs)
        if len(all_errors) > 20:
            all_errors.append("... (truncated after 20 errors)")
            break

    if all_errors:
        for e in all_errors:
            print(f"  VALIDATION ERROR: {e}", file=sys.stderr)
        raise RuntimeError(f"Output failed validation with {len(all_errors)} error(s).")

    k12_count = sum(1 for f in features if f["properties"]["level"] == "k12")
    col_count = sum(1 for f in features if f["properties"]["level"] == "college")
    enroll_non_null = sum(
        1 for f in features if f["properties"].get("enrollment") is not None
    )
    print(
        f"  k12={k12_count:,}  college={col_count:,}  total={len(features):,}  "
        f"enrollment_present={enroll_non_null:,}",
        flush=True,
    )
    print("  Validation passed.", flush=True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    print(f"=== ingest_schools.py  build_ts={BUILD_TS} ===\n", flush=True)

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # -------------------------------------------------------------------------
    # Phase 1: K-12 — NCES EDGE geocode (locations + names)
    # -------------------------------------------------------------------------
    print("[1/5] Downloading NCES EDGE geocode (K-12 locations + names)...", flush=True)
    geocode_zip = download_zip(NCES_GEOCODE_URL, "NCES EDGE geocode 2022-23")
    schools_geo = parse_edge_geocode(geocode_zip)

    # -------------------------------------------------------------------------
    # Phase 2: K-12 — CCD Membership (enrollment)
    # NOTE: This file is ~208 MB compressed. We stream it and filter in-place.
    # If download fails or column detection fails, enrollment will be null for K-12.
    # -------------------------------------------------------------------------
    print("\n[2/5] Downloading CCD Membership (K-12 enrollment, ~208 MB)...", flush=True)
    k12_enrollment: dict[str, int | None] = {}
    try:
        membership_zip = download_zip(CCD_MEMBERSHIP_URL, "NCES CCD Membership 2022-23")
        k12_enrollment = parse_ccd_membership(membership_zip)
        if not k12_enrollment:
            print(
                "  WARNING: Enrollment parsing returned empty dict. "
                "Enrollment will be null for K-12.",
                flush=True,
            )
    except Exception as exc:
        print(
            f"  WARNING: K-12 enrollment download/parse failed: {exc}\n"
            f"  Enrollment will be null for K-12 schools.",
            file=sys.stderr,
        )
        k12_enrollment = {}

    # -------------------------------------------------------------------------
    # Phase 3: Colleges — IPEDS HD2022 (locations + names)
    # -------------------------------------------------------------------------
    print("\n[3/5] Downloading IPEDS HD2022 (college locations)...", flush=True)
    college_dir_zip = download_zip(IPEDS_HD_URL, "IPEDS HD2022")
    institutions = parse_ipeds_hd(college_dir_zip)

    # -------------------------------------------------------------------------
    # Phase 4: Colleges — IPEDS EFFY2022 (enrollment)
    # -------------------------------------------------------------------------
    print("\n[4/5] Downloading IPEDS EFFY2022 (college enrollment)...", flush=True)
    college_enrollment: dict[str, int | None] = {}
    try:
        effy_zip = download_zip(IPEDS_EFFY_URL, "IPEDS EFFY2022")
        college_enrollment = parse_ipeds_effy(effy_zip)
    except Exception as exc:
        print(
            f"  WARNING: College enrollment download/parse failed: {exc}\n"
            f"  Enrollment will be null for colleges.",
            file=sys.stderr,
        )

    # -------------------------------------------------------------------------
    # Phase 5: Assemble GeoJSON
    # -------------------------------------------------------------------------
    print("\n[5/5] Assembling GeoJSON features...", flush=True)

    all_features: list[dict[str, Any]] = []

    # K-12 features
    for ncessch, geo in schools_geo.items():
        enroll = k12_enrollment.get(ncessch)
        all_features.append(
            make_feature(
                feat_id=f"nces-{ncessch}",
                name=geo["name"] or f"School {ncessch}",
                lat=geo["lat"],
                lng=geo["lng"],
                level="k12",
                enrollment=enroll,
                source="nces-2022-23",
            )
        )

    # College features
    for unitid, inst in institutions.items():
        enroll = college_enrollment.get(unitid)
        all_features.append(
            make_feature(
                feat_id=f"ipeds-{unitid}",
                name=inst["name"],
                lat=inst["lat"],
                lng=inst["lng"],
                level="college",
                enrollment=enroll,
                source="ipeds-2022-23",
            )
        )

    print(f"  Total features before dedupe: {len(all_features):,}", flush=True)

    # Dedupe by id (idempotent: keep first occurrence)
    seen_ids: set[str] = set()
    unique_features: list[dict[str, Any]] = []
    for feat in all_features:
        fid = feat["properties"]["id"]
        if fid not in seen_ids:
            seen_ids.add(fid)
            unique_features.append(feat)

    print(f"  Unique features after dedupe: {len(unique_features):,}", flush=True)

    # Validate against schema contract
    validate_output(unique_features)

    geojson: dict[str, Any] = {
        "type": "FeatureCollection",
        "features": unique_features,
        "metadata": {
            "generated_at": BUILD_TS,
            "sources": ["nces-2022-23", "ipeds-2022-23"],
            "record_count": len(unique_features),
        },
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(geojson, fh, separators=(",", ":"))

    size_mb = OUTPUT_FILE.stat().st_size / (1 << 20)
    print(
        f"\nWrote: {OUTPUT_FILE}",
        flush=True,
    )
    print(f"  Size: {size_mb:.1f} MB", flush=True)
    print(f"  Features: {len(unique_features):,}", flush=True)
    print("=== Done ===", flush=True)


if __name__ == "__main__":
    main()
