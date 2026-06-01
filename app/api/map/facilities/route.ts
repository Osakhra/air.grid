/**
 * GET /api/map/facilities
 * Returns top 10,000 facilities by emissions_value as GeoJSON.
 * Server-side read of facilities.geojson (90 MB) — never served raw to browser.
 */

import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

export const runtime = 'nodejs';
// Cache for 1 hour — facilities data is static (GHGRP 2022 vintage)
export const revalidate = 3600;

const FACILITIES_PATH = path.join(process.cwd(), 'public', 'data', 'facilities.geojson');
const TOP_N = 10_000;

interface FacilityProps {
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
}

interface Feature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: FacilityProps;
}

interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
  metadata?: Record<string, unknown>;
}

export async function GET() {
  try {
    const raw = fs.readFileSync(FACILITIES_PATH, 'utf-8');
    const fc: FeatureCollection = JSON.parse(raw);

    // Sort descending by emissions_value, take top N
    const sorted = fc.features
      .filter(
        (f) =>
          f.properties &&
          typeof f.properties.emissions_value === 'number' &&
          f.properties.lat != null &&
          f.properties.lng != null
      )
      .sort((a, b) => (b.properties.emissions_value ?? 0) - (a.properties.emissions_value ?? 0))
      .slice(0, TOP_N);

    const result: FeatureCollection = {
      type: 'FeatureCollection',
      features: sorted,
      metadata: {
        sampled: true,
        sample_size: sorted.length,
        total: fc.features.length,
        sort: 'emissions_value desc',
        served_at: new Date().toISOString(),
      },
    };

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    console.error('[api/map/facilities] error:', err);
    return NextResponse.json({ error: 'Failed to load facilities data' }, { status: 500 });
  }
}
