/**
 * app/api/refresh/route.ts
 * ========================
 * Vercel serverless function — hourly cron refresh for air-quality + wind data.
 *
 * Schedule: "0 * * * *" (every hour on the hour, UTC).
 * Accepts GET or POST so Vercel's cron scheduler (which sends GET) and manual
 * POST triggers from the orchestrator both work.
 *
 * Sources:
 *   - AirNow  (EPA AQI, official)
 *   - PurpleAir (crowdsourced PM2.5, EPA-corrected)
 *   - OpenAQ  (aggregator, fills gaps)
 *   - NWS api.weather.gov (wind speed + direction)
 *
 * Outputs (written to /data/ at project root):
 *   sensors.geojson  — GeoJSON FeatureCollection conforming to schema.contract.json#sensors
 *   wind.geojson     — GeoJSON FeatureCollection conforming to schema.contract.json#wind
 *
 * Environment variables (set in Vercel dashboard):
 *   AIRNOW_API_KEY
 *   PURPLEAIR_API_KEY  (or PURPLEAIR_READ_KEY — both accepted)
 *   OPENAQ_API_KEY
 *   NWS_CONTACT_EMAIL  (optional, used in User-Agent)
 */

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

// ──────────────────────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs"; // requires fs access
export const maxDuration = 300; // 5 minutes — enough for all API calls

const AIRNOW_KEY =
  process.env.AIRNOW_API_KEY ?? "";
const PURPLEAIR_KEY =
  process.env.PURPLEAIR_API_KEY ?? process.env.PURPLEAIR_READ_KEY ?? "";
const OPENAQ_KEY =
  process.env.OPENAQ_API_KEY ?? "";
const NWS_EMAIL =
  process.env.NWS_CONTACT_EMAIL ?? "evyosakhra@gmail.com";
const NWS_UA = `air.grid/1.0 ${NWS_EMAIL}`;

const DATA_DIR = path.join(process.cwd(), "public", "data");
const SENSORS_PATH = path.join(DATA_DIR, "sensors.geojson");
const WIND_PATH = path.join(DATA_DIR, "wind.geojson");

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface SensorProps {
  id: string;
  lat: number;
  lng: number;
  aqi: number | null;
  pm25: number | null;
  o3: number | null;
  observed_at: string;
  source: string;
}

interface WindProps {
  cell_id: string;
  lat: number;
  lng: number;
  speed_mps: number;
  dir_deg: number;
  observed_at: string;
  source: string;
}

interface GeoFeature<T> {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: T;
}

type SensorFeature = GeoFeature<SensorProps>;
type WindFeature = GeoFeature<WindProps>;

interface FeatureCollection<T> {
  type: "FeatureCollection";
  features: GeoFeature<T>[];
  _meta: {
    generated_at: string;
    count: number;
    description: string;
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function makeSensorFeature(
  id: string,
  lat: number,
  lng: number,
  aqi: number | null,
  pm25: number | null,
  o3: number | null,
  observed_at: string,
  source: string
): SensorFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { id, lat, lng, aqi, pm25, o3, observed_at, source },
  };
}

function makeWindFeature(
  cell_id: string,
  lat: number,
  lng: number,
  speed_mps: number,
  dir_deg: number,
  observed_at: string
): WindFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: {
      cell_id,
      lat,
      lng,
      speed_mps,
      dir_deg,
      observed_at,
      source: "nws-api-weather-gov",
    },
  };
}

async function safeFetch(
  url: string,
  init?: RequestInit
): Promise<Response | null> {
  try {
    const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    if (!resp.ok) {
      console.error(`[refresh] HTTP ${resp.status} for ${url}`);
      return null;
    }
    return resp;
  } catch (err) {
    console.error(`[refresh] fetch failed for ${url}:`, err);
    return null;
  }
}

function normalizeTs(ts: string | undefined | null): string {
  if (!ts) return nowIso();
  return ts.replace("+00:00", "Z").endsWith("Z") ? ts.replace("+00:00", "Z") : ts + "Z";
}

// ──────────────────────────────────────────────────────────────────────────────
// AirNow
// ──────────────────────────────────────────────────────────────────────────────

const AIRNOW_SAMPLE_POINTS: Array<[number, number]> = [
  [47.6, -122.3], [45.5, -122.7], [37.8, -122.4], [34.0, -118.2], [32.7, -117.2],
  [21.3, -157.8], [61.2, -149.9], [39.7, -104.9], [35.1, -106.7], [33.4, -112.1],
  [36.2, -115.2], [43.6, -116.2], [41.3, -105.6], [43.5, -96.7],  [39.0, -96.8],
  [41.9, -87.6],  [39.8, -86.2],  [41.5, -81.7],  [42.3, -83.0],  [44.9, -93.2],
  [38.6, -90.2],  [29.8, -95.4],  [30.3, -97.7],  [32.8, -97.3],  [35.5, -97.5],
  [36.2, -86.8],  [33.7, -84.4],  [29.9, -90.1],  [25.8, -80.2],  [27.9, -82.5],
  [38.9, -77.0],  [39.9, -75.2],  [40.7, -74.0],  [42.4, -71.1],  [44.5, -73.2],
  [43.0, -76.1],  [35.2, -80.8],  [32.9, -80.0],  [35.9, -78.8],  [30.5, -87.2],
];

async function fetchAirNow(): Promise<SensorFeature[]> {
  if (!AIRNOW_KEY) {
    console.warn("[refresh] AIRNOW_API_KEY not set — skipping");
    return [];
  }

  const features: SensorFeature[] = [];
  const seenIds = new Set<string>();
  const now = nowIso();

  for (const [lat, lng] of AIRNOW_SAMPLE_POINTS) {
    const url =
      `https://www.airnowapi.org/aq/observation/latLong/current/` +
      `?format=application/json&latitude=${lat}&longitude=${lng}&distance=25&API_KEY=${AIRNOW_KEY}`;

    const resp = await safeFetch(url);
    if (!resp) continue;

    let data: any[];
    try {
      data = await resp.json();
    } catch {
      continue;
    }
    if (!Array.isArray(data)) continue;

    for (const obs of data) {
      const stationCode = String(obs.ReportingArea ?? "").replace(/\s+/g, "_");
      const stateCode = String(obs.StateCode ?? "");
      const param: string = String(obs.ParameterName ?? "");
      const rawAqi = obs.AQI;
      const sLat = obs.Latitude;
      const sLng = obs.Longitude;

      if (sLat == null || sLng == null) continue;

      const stationId = `airnow-${stateCode}-${stationCode}`;
      if (seenIds.has(stationId)) continue;
      seenIds.add(stationId);

      const aqiVal = rawAqi != null && rawAqi !== -1 ? Number(rawAqi) : null;
      let pm25Val: number | null = null;
      let o3Val: number | null = null;
      const paramUp = param.toUpperCase();
      const conc = obs.Concentration != null ? Number(obs.Concentration) : null;
      if (paramUp.includes("PM2.5")) pm25Val = conc;
      else if (paramUp.includes("OZONE") || paramUp.includes("O3")) o3Val = conc;

      const dateStr = String(obs.DateObserved ?? "").trim().replace(/\s+/g, "");
      const hourStr = obs.HourObserved ?? 0;
      const observedAt = dateStr
        ? `${dateStr}T${String(Number(hourStr)).padStart(2, "0")}:00:00Z`
        : now;

      features.push(
        makeSensorFeature(stationId, Number(sLat), Number(sLng), aqiVal, pm25Val, o3Val, observedAt, "airnow")
      );
    }

    // Polite delay
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`[refresh] AirNow: ${features.length} features`);
  return features;
}

// ──────────────────────────────────────────────────────────────────────────────
// PurpleAir
// ──────────────────────────────────────────────────────────────────────────────

function epaCorrectedPm25(pm25cf1: number, humidity = 50): number {
  return Math.max(0, Math.round((0.52 * pm25cf1 - 0.086 * humidity + 5.75) * 100) / 100);
}

async function fetchPurpleAir(): Promise<SensorFeature[]> {
  if (!PURPLEAIR_KEY) {
    console.warn("[refresh] PURPLEAIR_API_KEY not set — skipping");
    return [];
  }

  const url = new URL("https://api.purpleair.com/v1/sensors");
  url.searchParams.set("fields", "sensor_index,latitude,longitude,pm2.5_cf_1,pm2.5_atm,last_seen");
  url.searchParams.set("nwlng", "-125");
  url.searchParams.set("nwlat", "50");
  url.searchParams.set("selng", "-65");
  url.searchParams.set("selat", "24");
  url.searchParams.set("max_age", "3600");

  const resp = await safeFetch(url.toString(), {
    headers: { "X-API-Key": PURPLEAIR_KEY },
  });
  if (!resp) return [];

  let data: any;
  try {
    data = await resp.json();
  } catch {
    return [];
  }

  const fieldNames: string[] = data.fields ?? [];
  const sensorData: any[][] = data.data ?? [];
  const idx = Object.fromEntries(fieldNames.map((f: string, i: number) => [f, i]));

  const features: SensorFeature[] = [];
  const seenLocs = new Set<string>();
  const now = nowIso();

  for (const row of sensorData) {
    const sensorIndex = row[idx["sensor_index"]];
    const lat = row[idx["latitude"]];
    const lng = row[idx["longitude"]];
    const pm25cf1 = row[idx["pm2.5_cf_1"]];
    const lastSeen = row[idx["last_seen"]];

    if (lat == null || lng == null) continue;
    const locKey = `${Math.round(lat * 100)}_${Math.round(lng * 100)}`;
    if (seenLocs.has(locKey)) continue;
    seenLocs.add(locKey);

    const pm25Corrected = pm25cf1 != null ? epaCorrectedPm25(Number(pm25cf1)) : null;
    const observedAt =
      lastSeen != null
        ? new Date(Number(lastSeen) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")
        : now;

    features.push(
      makeSensorFeature(
        `purpleair-${sensorIndex}`,
        Number(lat), Number(lng),
        null, pm25Corrected, null,
        observedAt, "purpleair-epa-corrected"
      )
    );
  }

  console.log(`[refresh] PurpleAir: ${features.length} features`);
  return features;
}

// ──────────────────────────────────────────────────────────────────────────────
// OpenAQ
// ──────────────────────────────────────────────────────────────────────────────

const OPENAQ_US_COUNTRY_ID = 155;

async function fetchOpenAQ(): Promise<SensorFeature[]> {
  if (!OPENAQ_KEY) {
    console.warn("[refresh] OPENAQ_API_KEY not set — skipping");
    return [];
  }

  const headers = { "X-API-Key": OPENAQ_KEY };
  const now = nowIso();

  // Step 1: collect location IDs with PM2.5 (parameter 2) in the US
  const locMeta: Record<string, { lat: number; lng: number }> = {};

  for (const [paramId, pages] of [[2, 2], [10, 1]] as const) {
    for (let page = 1; page <= pages; page++) {
      const url = new URL("https://api.openaq.org/v3/locations");
      url.searchParams.set("countries_id", String(OPENAQ_US_COUNTRY_ID));
      url.searchParams.set("parameters_id", String(paramId));
      url.searchParams.set("limit", "100");
      url.searchParams.set("page", String(page));

      const resp = await safeFetch(url.toString(), { headers });
      if (!resp) break;

      let data: any;
      try { data = await resp.json(); } catch { break; }
      const results: any[] = data.results ?? [];
      if (!results.length) break;

      for (const loc of results) {
        const lid = String(loc.id ?? "");
        const coords = loc.coordinates ?? {};
        if (lid && coords.latitude != null && coords.longitude != null) {
          locMeta[lid] = { lat: Number(coords.latitude), lng: Number(coords.longitude) };
        }
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  // Step 2: fetch /locations/{id}/sensors for latest readings (cap at 200)
  const readings: Record<string, { pm25: number | null; o3: number | null; observed_at: string }> = {};
  const locIds = Object.keys(locMeta).slice(0, 200);

  for (const locId of locIds) {
    const url = `https://api.openaq.org/v3/locations/${locId}/sensors`;
    const resp = await safeFetch(url, { headers });
    if (!resp) continue;

    let sensorList: any[];
    try { sensorList = (await resp.json()).results ?? []; } catch { continue; }

    let pm25Val: number | null = null;
    let o3Val: number | null = null;
    let observedAt = now;

    for (const s of sensorList) {
      const paramName: string = (s.parameter?.name ?? "").toLowerCase();
      const paramUnits: string = (s.parameter?.units ?? "").toLowerCase();
      const latest = s.latest;
      if (!latest || latest.value == null) continue;
      const ts = normalizeTs(latest.datetime?.utc);

      if (paramName === "pm25") {
        pm25Val = Number(latest.value);
        observedAt = ts;
      } else if (paramName === "o3") {
        const raw = Number(latest.value);
        o3Val = paramUnits.includes("ppm") ? Math.round(raw * 1000 * 1000) / 1000 : raw;
        if (pm25Val === null) observedAt = ts;
      }
    }

    if (pm25Val !== null || o3Val !== null) {
      readings[locId] = { pm25: pm25Val, o3: o3Val, observed_at: observedAt };
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // Step 3: build features
  const features: SensorFeature[] = Object.entries(readings).map(([locId, reading]) => {
    const meta = locMeta[locId]!;
    return makeSensorFeature(
      `openaq-${locId}`,
      meta.lat, meta.lng,
      null, reading.pm25, reading.o3,
      reading.observed_at, "openaq"
    );
  });

  console.log(`[refresh] OpenAQ: ${features.length} features`);
  return features;
}

// ──────────────────────────────────────────────────────────────────────────────
// NWS Wind
// ──────────────────────────────────────────────────────────────────────────────

const NWS_STATIONS: Array<[string, number, number]> = [
  ["KSEA",  47.45, -122.31], ["KPDX",  45.59, -122.60], ["KEUG",  44.12, -123.22],
  ["KSFO",  37.62, -122.37], ["KLAX",  33.94, -118.41], ["KSAN",  32.73, -117.19],
  ["KSAC",  38.51, -121.49], ["KFAT",  36.78, -119.72], ["KPHX",  33.43, -112.01],
  ["KTUS",  32.12, -110.94], ["KABQ",  35.04, -106.61], ["KLAS",  36.08, -115.15],
  ["KSLC",  40.79, -111.97], ["KDEN",  39.86, -104.67], ["KCOS",  38.81, -104.70],
  ["KBOI",  43.56, -116.22], ["KGTF",  47.48, -111.37], ["KOMA",  41.30,  -95.89],
  ["KICT",  37.65,  -97.43], ["KOKC",  35.39,  -97.60], ["KFSD",  43.58,  -96.74],
  ["KBIS",  46.77, -100.75], ["KORD",  41.98,  -87.91], ["KMDW",  41.79,  -87.75],
  ["KDET",  42.41,  -83.01], ["KIND",  39.72,  -86.28], ["KCMH",  39.99,  -82.89],
  ["KMSP",  44.88,  -93.22], ["KSTL",  38.75,  -90.37], ["KMKE",  42.95,  -87.90],
  ["KDSM",  41.53,  -93.66], ["KCLE",  41.41,  -81.85], ["KPIT",  40.49,  -80.23],
  ["KIAH",  29.98,  -95.34], ["KHOU",  29.65,  -95.28], ["KDFW",  32.90,  -97.04],
  ["KSAT",  29.53,  -98.47], ["KMSY",  29.99,  -90.26], ["KBTR",  30.53,  -91.15],
  ["KJAN",  32.32,  -90.08], ["KATL",  33.64,  -84.43], ["KBHM",  33.56,  -86.75],
  ["KMEM",  35.04,  -89.98], ["KBNA",  36.12,  -86.68], ["KLEX",  38.04,  -84.61],
  ["KMIA",  25.80,  -80.28], ["KTPA",  27.97,  -82.54], ["KDCA",  38.85,  -77.04],
  ["KIAD",  38.94,  -77.46], ["KBWI",  39.18,  -76.67], ["KPHL",  39.87,  -75.24],
  ["KJFK",  40.63,  -73.77], ["KLGA",  40.78,  -73.87], ["KEWR",  40.69,  -74.17],
  ["KBOS",  42.36,  -71.01], ["KBDL",  41.94,  -72.68], ["KPVD",  41.72,  -71.43],
  ["KBTV",  44.47,  -73.15], ["KBGR",  44.81,  -68.83], ["KCLT",  35.21,  -80.95],
  ["KRDU",  35.88,  -78.79], ["KCHS",  32.90,  -80.04], ["KSAV",  32.13,  -81.20],
  ["KJAX",  30.49,  -81.69], ["KMCO",  28.43,  -81.31], ["KPBI",  26.68,  -80.10],
  ["PANC",  61.17, -150.02], ["PAFA",  64.82, -147.86], ["PAJN",  58.36, -134.58],
  ["PHNL",  21.32, -157.92], ["PHTO",  19.72, -155.05], ["TJSJ",  18.44,  -66.00],
];

function kmhToMps(kmh: number): number {
  return Math.round((kmh / 3.6) * 1000) / 1000;
}

async function fetchNWSWind(): Promise<WindFeature[]> {
  const nwsHeaders = {
    "User-Agent": NWS_UA,
    "Accept": "application/geo+json",
  };

  const features: WindFeature[] = [];
  const now = nowIso();

  for (const [stationId, approxLat, approxLng] of NWS_STATIONS) {
    const url = `https://api.weather.gov/stations/${stationId}/observations/latest`;
    const resp = await safeFetch(url, { headers: nwsHeaders });
    if (!resp) continue;

    let obsData: any;
    try { obsData = await resp.json(); } catch { continue; }

    const props = obsData.properties ?? {};
    const windSpeedRaw = props.windSpeed ?? {};
    const windDirRaw = props.windDirection ?? {};

    const speedValue = typeof windSpeedRaw === "object" ? windSpeedRaw.value : windSpeedRaw;
    const speedUnit: string = typeof windSpeedRaw === "object" ? (windSpeedRaw.unitCode ?? "") : "";
    const dirValue = typeof windDirRaw === "object" ? windDirRaw.value : windDirRaw;

    if (speedValue == null || dirValue == null) continue;
    const speedFloat = Number(speedValue);
    const dirFloat = Number(dirValue);
    if (isNaN(speedFloat) || isNaN(dirFloat)) continue;

    // NWS windSpeed unitCode is "wmoUnit:km_h-1" for km/h
    const unitLower = speedUnit.toLowerCase();
    const speedMps = unitLower.includes("kt") || unitLower.includes("knot")
      ? Math.round(speedFloat * 0.514444 * 1000) / 1000
      : kmhToMps(speedFloat);

    // Prefer actual observation coordinates
    const coords = obsData.geometry?.coordinates;
    const obsLat = coords ? Number(coords[1]) : approxLat;
    const obsLng = coords ? Number(coords[0]) : approxLng;

    const timestamp: string | null = props.timestamp ?? null;
    const observedAt = timestamp ? normalizeTs(timestamp) : now;

    features.push(
      makeWindFeature(`nws-${stationId}`, obsLat, obsLng, speedMps, dirFloat, observedAt)
    );

    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`[refresh] NWS wind: ${features.length} features`);
  return features;
}

// ──────────────────────────────────────────────────────────────────────────────
// Deduplication (spatial, by rounded location key)
// ──────────────────────────────────────────────────────────────────────────────

const SOURCE_PRIORITY: Record<string, number> = {
  airnow: 0,
  openaq: 1,
  "purpleair-epa-corrected": 2,
};

function dedupeSensors(features: SensorFeature[]): SensorFeature[] {
  // Grid dedup at ~0.5 km resolution (round to 2 decimal places)
  const grid = new Map<string, SensorFeature>();

  for (const f of features) {
    const key = `${f.properties.lat.toFixed(2)}_${f.properties.lng.toFixed(2)}`;
    const existing = grid.get(key);
    if (!existing) {
      grid.set(key, f);
      continue;
    }
    // Keep higher-priority (lower score) source
    const newRank = SOURCE_PRIORITY[f.properties.source] ?? 99;
    const existRank = SOURCE_PRIORITY[existing.properties.source] ?? 99;
    if (newRank < existRank) grid.set(key, f);
  }

  return Array.from(grid.values());
}

// ──────────────────────────────────────────────────────────────────────────────
// GeoJSON writer
// ──────────────────────────────────────────────────────────────────────────────

async function writeGeoJSON<T>(
  filePath: string,
  features: GeoFeature<T>[],
  description: string
): Promise<void> {
  const collection: FeatureCollection<T> = {
    type: "FeatureCollection",
    features,
    _meta: {
      generated_at: nowIso(),
      count: features.length,
      description,
    },
  };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(collection, null, 2), "utf-8");
  console.log(`[refresh] Wrote ${features.length} features to ${filePath}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Main handler
// ──────────────────────────────────────────────────────────────────────────────

async function runRefresh(): Promise<{
  sensors_count: number;
  wind_count: number;
  live_sources: string[];
  failed_sources: string[];
  generated_at: string;
}> {
  const liveSources: string[] = [];
  const failedSources: string[] = [];

  // ── Sensors ──
  const allFeatures: SensorFeature[] = [];

  try {
    const airNowFeats = await fetchAirNow();
    if (airNowFeats.length) { liveSources.push("airnow"); allFeatures.push(...airNowFeats); }
    else failedSources.push("airnow");
  } catch (e) {
    console.error("[refresh] AirNow error:", e);
    failedSources.push("airnow");
  }

  try {
    const paFeats = await fetchPurpleAir();
    if (paFeats.length) { liveSources.push("purpleair-epa-corrected"); allFeatures.push(...paFeats); }
    else failedSources.push("purpleair");
  } catch (e) {
    console.error("[refresh] PurpleAir error:", e);
    failedSources.push("purpleair");
  }

  try {
    const oaqFeats = await fetchOpenAQ();
    if (oaqFeats.length) { liveSources.push("openaq"); allFeatures.push(...oaqFeats); }
    else failedSources.push("openaq");
  } catch (e) {
    console.error("[refresh] OpenAQ error:", e);
    failedSources.push("openaq");
  }

  const deduped = allFeatures.length ? dedupeSensors(allFeatures) : [];
  if (deduped.length) {
    await writeGeoJSON(
      SENSORS_PATH,
      deduped,
      "Live U.S. air-quality sensor readings (AirNow + PurpleAir + OpenAQ)"
    );
  } else {
    console.error("[refresh] No sensor features from any source — sensors.geojson not updated");
    failedSources.push("all-sensors");
  }

  // ── Wind ──
  let windFeats: WindFeature[] = [];
  try {
    windFeats = await fetchNWSWind();
    if (windFeats.length) liveSources.push("nws-api-weather-gov");
    else failedSources.push("nws");
  } catch (e) {
    console.error("[refresh] NWS wind error:", e);
    failedSources.push("nws");
  }

  if (windFeats.length) {
    await writeGeoJSON(
      WIND_PATH,
      windFeats,
      "NWS wind observations (speed + direction) for continental US"
    );
  } else {
    console.error("[refresh] No wind features — wind.geojson not updated");
  }

  return {
    sensors_count: deduped.length,
    wind_count: windFeats.length,
    live_sources: liveSources,
    failed_sources: failedSources,
    generated_at: nowIso(),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Route handlers
// ──────────────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest): Promise<NextResponse> {
  console.log("[refresh] GET triggered at", nowIso());
  try {
    const result = await runRefresh();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[refresh] Unhandled error:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function POST(_req: NextRequest): Promise<NextResponse> {
  console.log("[refresh] POST triggered at", nowIso());
  try {
    const result = await runRefresh();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[refresh] Unhandled error:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
