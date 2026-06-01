/**
 * GET /api/analysis/regional-breakdown
 * Assigns each facility to a US region by lat/lng bracket and returns
 * total emissions + facility count per region.
 */

import { NextResponse } from 'next/server';
import { getFacilities } from '@/app/lib/dataLoader';

export const runtime = 'nodejs';
export const revalidate = 3600;

type Region =
  | 'Northeast'
  | 'Southeast'
  | 'Midwest'
  | 'South Central'
  | 'Mountain West'
  | 'Pacific'
  | 'Other';

function assignRegion(lat: number, lng: number): Region {
  // Pacific: lng < -115
  if (lng < -115) return 'Pacific';
  // Mountain West: lng -115 to -105
  if (lng >= -115 && lng < -105) return 'Mountain West';
  // South Central: lng -105 to -95
  if (lng >= -105 && lng < -95) return 'South Central';
  // Midwest: lng -95 to -75, lat 37-49
  if (lng >= -95 && lng < -75 && lat >= 37 && lat <= 49) return 'Midwest';
  // Southeast: lat < 37, lng -95 to -75
  if (lng >= -95 && lng < -75 && lat < 37) return 'Southeast';
  // Northeast: lng > -80, lat > 37
  if (lng >= -80 && lat > 37) return 'Northeast';
  // Catch-all (southern border, Alaska outliers, etc.)
  return 'Other';
}

export async function GET() {
  try {
    const facilities = getFacilities();

    const regions: Record<Region, { totalEmissions: number; facilityCount: number; unit: string }> = {
      Northeast: { totalEmissions: 0, facilityCount: 0, unit: '' },
      Southeast: { totalEmissions: 0, facilityCount: 0, unit: '' },
      Midwest: { totalEmissions: 0, facilityCount: 0, unit: '' },
      'South Central': { totalEmissions: 0, facilityCount: 0, unit: '' },
      'Mountain West': { totalEmissions: 0, facilityCount: 0, unit: '' },
      Pacific: { totalEmissions: 0, facilityCount: 0, unit: '' },
      Other: { totalEmissions: 0, facilityCount: 0, unit: '' },
    };

    for (const f of facilities.features) {
      const { lat, lng, emissions_value, emissions_unit } = f.properties;
      if (lat == null || lng == null) continue;
      const region = assignRegion(lat, lng);
      regions[region].totalEmissions += emissions_value ?? 0;
      regions[region].facilityCount += 1;
      if (!regions[region].unit && emissions_unit) {
        regions[region].unit = emissions_unit;
      }
    }

    const result = Object.entries(regions)
      .filter(([, v]) => v.facilityCount > 0)
      .map(([region, data]) => ({ region, ...data }))
      .sort((a, b) => b.totalEmissions - a.totalEmissions);

    return NextResponse.json(result);
  } catch (err) {
    console.error('[analysis/regional-breakdown] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
