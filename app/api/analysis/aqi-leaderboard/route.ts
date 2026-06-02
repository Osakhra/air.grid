import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function GET() {
  try {
    // Sensors are live — skip cache so we always get the latest baked file.
    const res = await fetch(`${BASE_URL}/data/sensors.geojson`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fc = await res.json();

    const generatedAt: string | null =
      fc._meta?.generated_at ?? fc.metadata?.built_at ?? null;

    const top20 = (fc.features ?? [])
      .filter((f: any) => f.properties?.aqi != null)
      .sort((a: any, b: any) => b.properties.aqi - a.properties.aqi)
      .slice(0, 20)
      .map((f: any) => ({
        id: f.properties.id,
        lat: f.properties.lat,
        lng: f.properties.lng,
        aqi: f.properties.aqi,
        pm25: f.properties.pm25 ?? null,
        o3: f.properties.o3 ?? null,
        observed_at: f.properties.observed_at,
        source: f.properties.source,
      }));

    return NextResponse.json({ data: top20, generatedAt });
  } catch (err) {
    console.error('[analysis/aqi-leaderboard]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
