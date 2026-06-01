/**
 * app/lib/dataLoader.ts
 * =====================
 * Server-side only. Reads and module-level caches the large GeoJSON files so
 * repeated API route calls within the same process do not re-parse 90 MB of JSON.
 *
 * Single source of truth: every API route that needs raw features imports from
 * here. No data-loading logic is duplicated.
 *
 * IMPORTANT: This module uses `fs` — it must only run in Node.js server context
 * (API routes, Server Components reading via fetch). Never import into client
 * components.
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');

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

// ── Module-level cache (survives across requests in same process) ──────────────

let _facilities: GeoFeatureCollection<FacilityProps> | null = null;
let _sensors: GeoFeatureCollection<SensorProps> | null = null;
let _schools: GeoFeatureCollection<SchoolProps> | null = null;
let _schoolExposure: GeoFeatureCollection<SchoolExposureProps> | null = null;
let _facilityDemographics: GeoFeatureCollection<FacilityDemographicsProps> | null = null;

function readJson<T>(filePath: string): GeoFeatureCollection<T> {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as GeoFeatureCollection<T>;
}

// ── Public loaders ─────────────────────────────────────────────────────────────

export function getFacilities(): GeoFeatureCollection<FacilityProps> {
  if (!_facilities) {
    _facilities = readJson<FacilityProps>(path.join(DATA_DIR, 'facilities.geojson'));
  }
  return _facilities;
}

export function getSensors(): GeoFeatureCollection<SensorProps> {
  if (!_sensors) {
    _sensors = readJson<SensorProps>(path.join(DATA_DIR, 'sensors.geojson'));
  }
  return _sensors;
}

export function getSchools(): GeoFeatureCollection<SchoolProps> {
  if (!_schools) {
    _schools = readJson<SchoolProps>(path.join(DATA_DIR, 'schools.geojson'));
  }
  return _schools;
}

export function getSchoolExposure(): GeoFeatureCollection<SchoolExposureProps> {
  if (!_schoolExposure) {
    _schoolExposure = readJson<SchoolExposureProps>(
      path.join(DATA_DIR, 'joins', 'school_exposure.geojson')
    );
  }
  return _schoolExposure;
}

export function getFacilityDemographics(): GeoFeatureCollection<FacilityDemographicsProps> {
  if (!_facilityDemographics) {
    _facilityDemographics = readJson<FacilityDemographicsProps>(
      path.join(DATA_DIR, 'joins', 'facility_demographics.geojson')
    );
  }
  return _facilityDemographics;
}
