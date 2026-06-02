import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function GET() {
  try {
    // Fetch both files in parallel.
    const [demoRes, facRes] = await Promise.all([
      fetch(`${BASE_URL}/data/joins/facility_demographics.geojson`, { next: { revalidate: 86400 } }),
      fetch(`${BASE_URL}/data/facilities.geojson`, { next: { revalidate: 86400 } }),
    ]);
    if (!demoRes.ok) throw new Error(`facility_demographics HTTP ${demoRes.status}`);
    if (!facRes.ok)  throw new Error(`facilities HTTP ${facRes.status}`);

    const [demographics, facilities] = await Promise.all([demoRes.json(), facRes.json()]);

    // Build emissions lookup by facility id
    const emissionsById: Record<string, { emissions_value: number; emissions_unit: string; type: string }> = {};
    for (const f of facilities.features ?? []) {
      emissionsById[f.properties?.id] = {
        emissions_value: f.properties?.emissions_value ?? 0,
        emissions_unit: f.properties?.emissions_unit ?? '',
        type: f.properties?.type ?? '',
      };
    }

    const hotspots = (demographics.features ?? [])
      .filter((f: any) => (f.properties?.pct_minority ?? 0) > 0.6)
      .map((f: any) => {
        const em = emissionsById[f.properties?.facility_id] ?? {
          emissions_value: 0, emissions_unit: '', type: '',
        };
        return {
          facility_id: f.properties.facility_id,
          facility_name: f.properties.facility_name,
          lat: f.properties.lat,
          lng: f.properties.lng,
          type: em.type,
          emissions_value: em.emissions_value,
          emissions_unit: em.emissions_unit,
          pct_minority: f.properties.pct_minority,
          median_income: f.properties.median_income ?? null,
          population: f.properties.population ?? null,
          geoid: f.properties.geoid,
          source: f.properties.source,
        };
      })
      .sort((a: any, b: any) => b.emissions_value - a.emissions_value)
      .slice(0, 20);

    return NextResponse.json(hotspots);
  } catch (err) {
    console.error('[analysis/ej-hotspots]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
