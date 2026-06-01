/**
 * GET /api/analysis/ej-hotspots
 * Environmental Justice hotspots: top 20 facilities with highest emissions
 * located in Census tracts where pct_minority > 0.6 (majority-minority).
 * Joins facility_demographics with the emissions from the facilities table.
 */

import { NextResponse } from 'next/server';
import { getFacilityDemographics, getFacilities } from '@/app/lib/dataLoader';

export const runtime = 'nodejs';
export const revalidate = 3600;

export async function GET() {
  try {
    const demographics = getFacilityDemographics();
    const facilities = getFacilities();

    // Build emissions lookup by facility_id
    const emissionsById: Record<string, { emissions_value: number; emissions_unit: string; type: string }> = {};
    for (const f of facilities.features) {
      emissionsById[f.properties.id] = {
        emissions_value: f.properties.emissions_value ?? 0,
        emissions_unit: f.properties.emissions_unit ?? '',
        type: f.properties.type ?? '',
      };
    }

    const hotspots = demographics.features
      .filter((f) => (f.properties.pct_minority ?? 0) > 0.6)
      .map((f) => {
        const em = emissionsById[f.properties.facility_id] ?? {
          emissions_value: 0,
          emissions_unit: '',
          type: '',
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
          median_income: f.properties.median_income,
          population: f.properties.population,
          geoid: f.properties.geoid,
          source: f.properties.source,
        };
      })
      .sort((a, b) => b.emissions_value - a.emissions_value)
      .slice(0, 20);

    return NextResponse.json(hotspots);
  } catch (err) {
    console.error('[analysis/ej-hotspots] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
