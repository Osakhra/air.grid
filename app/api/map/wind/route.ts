/**
 * GET /api/map/wind
 * Returns all 76 wind observation points as GeoJSON.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function GET() {
  try {
    const res = await fetch(`${BASE_URL}/data/wind.geojson`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fc = await res.json();

    return NextResponse.json(fc, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err) {
    console.error('[api/map/wind] error:', err);
    return NextResponse.json({ error: 'Failed to load wind data' }, { status: 500 });
  }
}
