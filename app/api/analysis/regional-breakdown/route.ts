import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

type Region = 'Northeast' | 'Southeast' | 'Midwest' | 'South Central' | 'Mountain West' | 'Pacific' | 'Other';

function assignRegion(lat: number, lng: number): Region {
  if (lng < -115) return 'Pacific';
  if (lng < -105) return 'Mountain West';
  if (lng < -95)  return 'South Central';
  if (lng < -75 && lat >= 37) return 'Midwest';
  if (lng < -75 && lat < 37)  return 'Southeast';
  if (lng >= -80 && lat > 37) return 'Northeast';
  return 'Other';
}

export async function GET() {
  try {
    const res = await fetch(`${BASE_URL}/data/facilities.geojson`, {
      next: { revalidate: 86400 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fc = await res.json();

    const regions: Record<Region, { totalEmissions: number; facilityCount: number; unit: string }> = {
      Northeast:      { totalEmissions: 0, facilityCount: 0, unit: '' },
      Southeast:      { totalEmissions: 0, facilityCount: 0, unit: '' },
      Midwest:        { totalEmissions: 0, facilityCount: 0, unit: '' },
      'South Central':{ totalEmissions: 0, facilityCount: 0, unit: '' },
      'Mountain West':{ totalEmissions: 0, facilityCount: 0, unit: '' },
      Pacific:        { totalEmissions: 0, facilityCount: 0, unit: '' },
      Other:          { totalEmissions: 0, facilityCount: 0, unit: '' },
    };

    for (const f of fc.features ?? []) {
      const { lat, lng, emissions_value, emissions_unit } = f.properties ?? {};
      if (lat == null || lng == null) continue;
      const region = assignRegion(lat, lng);
      regions[region].totalEmissions += emissions_value ?? 0;
      regions[region].facilityCount += 1;
      if (!regions[region].unit && emissions_unit) regions[region].unit = emissions_unit;
    }

    const result = (Object.entries(regions) as [Region, typeof regions[Region]][])
      .map(([region, data]) => ({ region, ...data }))
      .filter((r) => r.facilityCount > 0)
      .sort((a, b) => b.totalEmissions - a.totalEmissions);

    return NextResponse.json(result);
  } catch (err) {
    console.error('[analysis/regional-breakdown]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
