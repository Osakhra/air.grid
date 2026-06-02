import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function GET() {
  try {
    // Fetch both files in parallel — both are static at deploy time.
    const [expRes, schRes] = await Promise.all([
      fetch(`${BASE_URL}/data/joins/school_exposure.geojson`, { next: { revalidate: 86400 } }),
      fetch(`${BASE_URL}/data/schools.geojson`, { next: { revalidate: 86400 } }),
    ]);
    if (!expRes.ok) throw new Error(`school_exposure HTTP ${expRes.status}`);
    if (!schRes.ok) throw new Error(`schools HTTP ${schRes.status}`);

    const [exposure, schools] = await Promise.all([expRes.json(), schRes.json()]);

    // Build school metadata lookup
    const schoolMeta: Record<string, { level: string; enrollment: number | null }> = {};
    for (const f of schools.features ?? []) {
      schoolMeta[f.properties?.id] = {
        level: f.properties?.level ?? 'unknown',
        enrollment: f.properties?.enrollment ?? null,
      };
    }

    const top20 = (exposure.features ?? [])
      .filter((f: any) => (f.properties?.max_emissions_nearby ?? 0) > 0)
      .sort((a: any, b: any) => b.properties.max_emissions_nearby - a.properties.max_emissions_nearby)
      .slice(0, 20)
      .map((f: any) => {
        const meta = schoolMeta[f.properties?.school_id] ?? { level: 'unknown', enrollment: null };
        return {
          school_id: f.properties.school_id,
          school_name: f.properties.school_name,
          lat: f.properties.lat,
          lng: f.properties.lng,
          level: meta.level,
          enrollment: meta.enrollment,
          max_emissions_nearby: f.properties.max_emissions_nearby,
          nearest_aqi: f.properties.nearest_aqi ?? null,
          is_downwind: f.properties.is_downwind ?? false,
          nearest_sensor_distance_m: f.properties.nearest_sensor_distance_m ?? null,
          source: f.properties.source,
        };
      });

    return NextResponse.json(top20);
  } catch (err) {
    console.error('[analysis/most-exposed-schools]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
