/**
 * GET /api/analysis/pollutant-breakdown
 * Groups facilities by primary pollutant and returns top 10 categories
 * by total reported emissions.
 */

import { NextResponse } from 'next/server';
import { getFacilities } from '@/app/lib/dataLoader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const facilities = await getFacilities();

    // Tally by primary pollutant (first in the pollutants array)
    const byPollutant: Record<string, { count: number; totalEmissions: number; unit: string }> = {};

    for (const f of facilities.features) {
      const { pollutants, emissions_value, emissions_unit } = f.properties;
      const primary =
        Array.isArray(pollutants) && pollutants.length > 0
          ? (pollutants[0] as string)
          : 'Unknown';

      if (!byPollutant[primary]) {
        byPollutant[primary] = { count: 0, totalEmissions: 0, unit: emissions_unit ?? '' };
      }
      byPollutant[primary].count += 1;
      byPollutant[primary].totalEmissions += emissions_value ?? 0;
    }

    const top10 = Object.entries(byPollutant)
      .map(([pollutant, data]) => ({ pollutant, ...data }))
      .sort((a, b) => b.totalEmissions - a.totalEmissions)
      .slice(0, 10);

    return NextResponse.json(top10);
  } catch (err) {
    console.error('[analysis/pollutant-breakdown] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
