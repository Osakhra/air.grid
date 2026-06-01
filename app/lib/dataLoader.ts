/**
 * app/lib/dataLoader.ts
 * =====================
 * Server-side only. Fetches GeoJSON files from /public/data/ (served as static
 * CDN assets) and caches the parsed result at the Promise level so concurrent
 * first requests within a function instance share one in-flight fetch rather
 * than each kicking off their own.
 *
 * Why fetch() instead of fs.readFileSync():
 *   On Vercel, /public/ is a CDN-only directory — serverless function bundles
 *   do not include those files and fs reads from that path throw ENOENT.
 *   Fetching via HTTP hits the CDN, avoids bundling 300 MB of GeoJSON into
 *   functions, and stays within the 250 MB unzipped function limit.
 *
 * Never import this into client components.
 */

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GeoFeatureCollection<T = Record<string, unknown>> {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: string; coordinates: number[] | number[][] };
    properties: T;
  }>;
  _meta?: {
    generated_at?: string;
    count?: number;
    description?: string;
  };
  metadata?: {
    source?: string;
    built_at?: string;
    record_count?: number;
    [key: string]: unknown;
  };
}

export interface FacilityProps {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: string;
  operator?: string;
  pollutants: string[];
  emissions_value: number;
  emissions_unit: string;
  year?: number;
  source: string;
}

export interface SensorProps {
  id: string;
  lat: number;
  lng: number;
  aqi: number | null;
  pm25: number | null;
  o3: number | null;
  observed_at: string;
  source: string;
}

export interface SchoolProps {
  id: string;
  name: string;
  lat: number;
  lng: number;
  level: string;
  enrollment: number | null;
  source: string;
}

export interface SchoolExposureProps {
  school_id: string;
  school_name: string;
  lat: number;
  lng: number;
  nearest_facility_ids: string[];
  nearest_facility_distances_m: number[];
  max_emissions_nearby: number;
  nearest_aqi: number | null;
  nearest_sensor_id: string | null;
  nearest_sensor_distance_m: number | null;
  is_downwind: boolean;
  source: string;
}

export interface FacilityDemographicsProps {
  facility_id: string;
  facility_name: string;
  lat: number;
  lng: number;
  geoid: string;
  population: number | null;
  median_income: number | null;
  pct_minority: number;
  source: string;
}

// ── Fetch helper ───────────────────────────────────────────────────────────────

async function fetchGeoJson<T>(publicPath: string): Promise<GeoFeatureCollection<T>> {
  const url = `${BASE_URL}${publicPath}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GeoJSON fetch failed: ${url} → HTTP ${res.status}`);
  return res.json() as Promise<GeoFeatureCollection<T>>;
}

// ── Promise-level module cache ─────────────────────────────────────────────────
// Storing the Promise (not the resolved value) means concurrent first requests
// all await the same in-flight fetch instead of each starting their own.

let _facilities: Promise<GeoFeatureCollection<FacilityProps>> | null = null;
let _sensors: Promise<GeoFeatureCollection<SensorProps>> | null = null;
let _schools: Promise<GeoFeatureCollection<SchoolProps>> | null = null;
let _schoolExposure: Promise<GeoFeatureCollection<SchoolExposureProps>> | null = null;
let _facilityDemographics: Promise<GeoFeatureCollection<FacilityDemographicsProps>> | null = null;

// ── Public loaders ─────────────────────────────────────────────────────────────

export function getFacilities(): Promise<GeoFeatureCollection<FacilityProps>> {
  if (!_facilities) _facilities = fetchGeoJson<FacilityProps>('/data/facilities.geojson');
  return _facilities;
}

export function getSensors(): Promise<GeoFeatureCollection<SensorProps>> {
  if (!_sensors) _sensors = fetchGeoJson<SensorProps>('/data/sensors.geojson');
  return _sensors;
}

export function getSchools(): Promise<GeoFeatureCollection<SchoolProps>> {
  if (!_schools) _schools = fetchGeoJson<SchoolProps>('/data/schools.geojson');
  return _schools;
}

export function getSchoolExposure(): Promise<GeoFeatureCollection<SchoolExposureProps>> {
  if (!_schoolExposure)
    _schoolExposure = fetchGeoJson<SchoolExposureProps>('/data/joins/school_exposure.geojson');
  return _schoolExposure;
}

export function getFacilityDemographics(): Promise<GeoFeatureCollection<FacilityDemographicsProps>> {
  if (!_facilityDemographics)
    _facilityDemographics = fetchGeoJson<FacilityDemographicsProps>(
      '/data/joins/facility_demographics.geojson'
    );
  return _facilityDemographics;
}
