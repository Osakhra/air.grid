/**
 * GET /api/map/demographics
 * Returns up to 15,000 Census tract centroids for the demographics layer.
 * Sampled to keep response size reasonable for the browser.
 */

import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

export const runtime = 'nodejs';
export const revalidate = 86400; // demographics data is static (ACS 2022)

const DEMO_PATH = path.join(process.cwd(), 'public', 'data', 'demographics.geojson');
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
    const raw = fs.readFileSync(DEMO_PATH, 'utf-8');
    const fc: FeatureCollection = JSON.parse(raw);

    const valid = fc.features.filter(
      (f) =>
        f.properties &&
        f.properties.lat != null &&
        f.properties.lng != null &&
        typeof f.properties.pct_minority === 'number'
    );

    // Deterministic sample: every Nth feature to spread geographically
    const step = Math.max(1, Math.floor(valid.length / SAMPLE_N));
    const sampled = valid.filter((_, i) => i % step === 0).slice(0, SAMPLE_N);

    const result = {
      type: 'FeatureCollection',
      features: sampled,
      metadata: {
        sampled: true,
        sample_size: sampled.length,
        total: fc.features.length,
        served_at: new Date().toISOString(),
      },
    };

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
      },
    });
  } catch (err) {
    console.error('[api/map/demographics] error:', err);
    return NextResponse.json({ error: 'Failed to load demographics data' }, { status: 500 });
  }
}
