/**
 * GET /api/map/facilities
 * Returns top 10,000 facilities by emissions_value as GeoJSON.
 * Fetches facilities.geojson from the CDN (/public/data/) server-side —
 * never serves the raw 90 MB file to the browser.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

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
    const res = await fetch(`${BASE_URL}/data/facilities.geojson`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fc: FeatureCollection = await res.json();

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

    return NextResponse.json(
      {
        type: 'FeatureCollection',
        features: sorted,
        metadata: {
          sampled: true,
          sample_size: sorted.length,
          total: fc.features.length,
          sort: 'emissions_value desc',
          served_at: new Date().toISOString(),
        },
      },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } }
    );
  } catch (err) {
    console.error('[api/map/facilities] error:', err);
    return NextResponse.json({ error: 'Failed to load facilities data' }, { status: 500 });
  }
}
