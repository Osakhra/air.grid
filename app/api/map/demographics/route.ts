/**
 * GET /api/map/demographics
 * Returns up to 15,000 Census tract centroids for the demographics layer.
 * Sampled to keep response size reasonable for the browser.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

const SAMPLE_N = 15_000;

interface DemoProps {
  geoid: string;
  lat: number;
  lng: number;
  population: number;
  median_income: number | null;
  pct_minority: number;
  source: string;
}

interface Feature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: DemoProps;
}

interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
}

export async function GET() {
  try {
    const res = await fetch(`${BASE_URL}/data/demographics.geojson`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fc: FeatureCollection = await res.json();

    const valid = fc.features.filter(
      (f) =>
        f.properties &&
        f.properties.lat != null &&
        f.properties.lng != null &&
        typeof f.properties.pct_minority === 'number'
    );

    const step = Math.max(1, Math.floor(valid.length / SAMPLE_N));
    const sampled = valid.filter((_, i) => i % step === 0).slice(0, SAMPLE_N);

    return NextResponse.json(
      {
        type: 'FeatureCollection',
        features: sampled,
        metadata: {
          sampled: true,
          sample_size: sampled.length,
          total: fc.features.length,
          served_at: new Date().toISOString(),
        },
      },
      { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' } }
    );
  } catch (err) {
    console.error('[api/map/demographics] error:', err);
    return NextResponse.json({ error: 'Failed to load demographics data' }, { status: 500 });
  }
}
