/**
 * GET /api/map/schools
 * Returns up to 20,000 schools sorted by enrollment descending as GeoJSON.
 * Server-side read of schools.geojson (28 MB) — never served raw to browser.
 */

import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

export const runtime = 'nodejs';
export const revalidate = 3600;

const SCHOOLS_PATH = path.join(process.cwd(), 'data', 'schools.geojson');
const TOP_N = 20_000;

interface SchoolProps {
  id: string;
  name: string;
  lat: number;
  lng: number;
  level: 'k12' | 'college';
  enrollment: number | null;
  source: string;
}

interface Feature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: SchoolProps;
}

interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
}

export async function GET() {
  try {
    const raw = fs.readFileSync(SCHOOLS_PATH, 'utf-8');
    const fc: FeatureCollection = JSON.parse(raw);

    const valid = fc.features.filter(
      (f) => f.properties && f.properties.lat != null && f.properties.lng != null
    );

    // Sort by enrollment descending (nulls last), cap at TOP_N
    const sorted = valid
      .sort((a, b) => (b.properties.enrollment ?? 0) - (a.properties.enrollment ?? 0))
      .slice(0, TOP_N);

    const result = {
      type: 'FeatureCollection',
      features: sorted,
      metadata: {
        sampled: true,
        sample_size: sorted.length,
        total: fc.features.length,
        sort: 'enrollment desc',
        served_at: new Date().toISOString(),
      },
    };

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    console.error('[api/map/schools] error:', err);
    return NextResponse.json({ error: 'Failed to load schools data' }, { status: 500 });
  }
}
