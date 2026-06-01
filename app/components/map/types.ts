/**
 * Shared types for the map layer system.
 */

export interface FacilityFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    id: string;
    name: string;
    lat: number;
    lng: number;
    type: string;
    operator?: string;
    pollutants: string[];
    emissions_value: number;
    emissions_unit: string;
    year: number;
    source: string;
  };
}

export interface SensorFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    id: string;
    lat: number;
    lng: number;
    aqi: number | null;
    pm25: number | null;
    o3: number | null;
    observed_at: string;
    source: string;
  };
}

export interface SchoolFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    id: string;
    name: string;
    lat: number;
    lng: number;
    level: 'k12' | 'college';
    enrollment: number | null;
    source: string;
  };
}

export interface WindFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    cell_id: string;
    lat: number;
    lng: number;
    speed_mps: number;
    dir_deg: number;
    observed_at: string;
    source: string;
  };
}

export interface DemoFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    geoid: string;
    lat: number;
    lng: number;
    population: number;
    median_income: number | null;
    pct_minority: number;
    source: string;
  };
}

export type HoveredObject =
  | { kind: 'facility'; props: FacilityFeature['properties'] }
  | { kind: 'sensor'; props: SensorFeature['properties'] }
  | { kind: 'school'; props: SchoolFeature['properties'] }
  | { kind: 'wind'; props: WindFeature['properties'] }
  | { kind: 'demo'; props: DemoFeature['properties'] };

export interface TooltipState {
  x: number;
  y: number;
  object: HoveredObject;
}

export interface LayerVisibility {
  facilities: boolean;
  sensors: boolean;
  schools: boolean;
  wind: boolean;
  demographics: boolean;
}
