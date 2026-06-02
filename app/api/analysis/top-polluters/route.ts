import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function GET() {
  try {
    // Static at deploy time — use Vercel's shared cache so cold starts are instant.
    const res = await fetch(`${BASE_URL}/data/facilities.geojson`, {
      next: { revalidate: 86400 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fc = await res.json();

    const top20 = (fc.features ?? [])
      .filter((f: any) => (f.properties?.emissions_value ?? 0) > 0)
      .sort((a: any, b: any) => b.properties.emissions_value - a.properties.emissions_value)
      .slice(0, 20)
      .map((f: any) => ({
        id: f.properties.id,
        name: f.properties.name,
        type: f.properties.type,
        lat: f.properties.lat,
        lng: f.properties.lng,
        emissions_value: f.properties.emissions_value,
        emissions_unit: f.properties.emissions_unit,
        pollutants: f.properties.pollutants ?? [],
        source: f.properties.source,
      }));

    return NextResponse.json(top20);
  } catch (err) {
    console.error('[analysis/top-polluters]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
