/**
 * GET /api/map/wind
 * Returns all 76 wind observation points as GeoJSON.
 */

import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

export const runtime = 'nodejs';

const WIND_PATH = path.join(process.cwd(), 'data', 'wind.geojson');

export async function GET() {
  try {
    const raw = fs.readFileSync(WIND_PATH, 'utf-8');
    const fc = JSON.parse(raw);

    return NextResponse.json(fc, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (err) {
    console.error('[api/map/wind] error:', err);
    return NextResponse.json({ error: 'Failed to load wind data' }, { status: 500 });
  }
}
