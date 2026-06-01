/**
 * GET /api/analysis/aqi-leaderboard
 * Returns top 20 sensor readings ordered by AQI descending (worst first).
 * Only includes sensors that have a non-null AQI value.
 */

import { NextResponse } from 'next/server';
import { getSensors } from '@/app/lib/dataLoader';

export const runtime = 'nodejs';
export const revalidate = 3600;

export async function GET() {
  try {
    const sensors = getSensors();

    const top20 = sensors.features
      .filter((f) => f.properties.aqi !== null && f.properties.aqi !== undefined)
      .sort((a, b) => (b.properties.aqi as number) - (a.properties.aqi as number))
      .slice(0, 20)
      .map((f) => ({
        id: f.properties.id,
        lat: f.properties.lat,
        lng: f.properties.lng,
        aqi: f.properties.aqi,
        pm25: f.properties.pm25,
        o3: f.properties.o3,
        observed_at: f.properties.observed_at,
        source: f.properties.source,
      }));

    const generatedAt =
      (sensors._meta?.generated_at as string | undefined) ??
      (sensors.metadata?.built_at as string | undefined) ??
      null;

    return NextResponse.json({ data: top20, generatedAt });
  } catch (err) {
    console.error('[analysis/aqi-leaderboard] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
