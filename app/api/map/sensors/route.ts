/**
 * GET /api/map/sensors
 * Returns all sensor readings as GeoJSON (~4 MB, 15,897 pts — small enough).
 * Short cache so the live header shows recent data.
 */

import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

export const runtime = 'nodejs';

const SENSORS_PATH = path.join(process.cwd(), 'data', 'sensors.geojson');

export async function GET() {
  try {
    const raw = fs.readFileSync(SENSORS_PATH, 'utf-8');
    const fc = JSON.parse(raw);

    return NextResponse.json(fc, {
      headers: {
        // 5-minute cache so the polling interval can pick up refreshed data
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (err) {
    console.error('[api/map/sensors] error:', err);
    return NextResponse.json({ error: 'Failed to load sensor data' }, { status: 500 });
  }
}
