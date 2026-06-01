/**
 * GET /api/analysis/top-polluters
 * Returns the top 20 facilities by emissions_value (desc).
 * Only GHGRP facilities have meaningful quantitative emissions_value.
 */

import { NextResponse } from 'next/server';
import { getFacilities } from '@/app/lib/dataLoader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const facilities = await getFacilities();

    const top20 = facilities.features
      .filter((f) => f.properties.emissions_value > 0)
      .sort((a, b) => b.properties.emissions_value - a.properties.emissions_value)
      .slice(0, 20)
      .map((f) => ({
        id: f.properties.id,
        name: f.properties.name,
        type: f.properties.type,
        lat: f.properties.lat,
        lng: f.properties.lng,
        emissions_value: f.properties.emissions_value,
        emissions_unit: f.properties.emissions_unit,
        pollutants: f.properties.pollutants,
        source: f.properties.source,
      }));

    return NextResponse.json(top20);
  } catch (err) {
    console.error('[analysis/top-polluters] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
