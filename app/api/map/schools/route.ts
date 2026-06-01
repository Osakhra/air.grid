/**
 * GET /api/map/schools
 * Returns up to 20,000 schools sorted by enrollment descending as GeoJSON.
 * Fetches schools.geojson from the CDN (/public/data/) server-side —
 * never serves the raw 28 MB file to the browser.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

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
    const res = await fetch(`${BASE_URL}/data/schools.geojson`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fc: FeatureCollection = await res.json();

    const valid = fc.features.filter(
      (f) => f.properties && f.properties.lat != null && f.properties.lng != null
    );

    const sorted = valid
      .sort((a, b) => (b.properties.enrollment ?? 0) - (a.properties.enrollment ?? 0))
      .slice(0, TOP_N);

    return NextResponse.json(
      {
        type: 'FeatureCollection',
        features: sorted,
        metadata: {
          sampled: true,
          sample_size: sorted.length,
          total: fc.features.length,
          sort: 'enrollment desc',
          served_at: new Date().toISOString(),
        },
      },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } }
    );
  } catch (err) {
    console.error('[api/map/schools] error:', err);
    return NextResponse.json({ error: 'Failed to load schools data' }, { status: 500 });
  }
}
