import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function GET() {
  try {
    const res = await fetch(`${BASE_URL}/data/facilities.geojson`, {
      next: { revalidate: 86400 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fc = await res.json();

    const byPollutant: Record<string, { count: number; totalEmissions: number; unit: string }> = {};

    for (const f of fc.features ?? []) {
      const { pollutants, emissions_value, emissions_unit } = f.properties ?? {};
      const primary =
        Array.isArray(pollutants) && pollutants.length > 0 ? String(pollutants[0]) : 'Unknown';

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
    console.error('[analysis/pollutant-breakdown]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
