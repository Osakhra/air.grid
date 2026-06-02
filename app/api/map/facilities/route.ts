import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

// Pre-computed at build time: top 10,000 facilities by emissions_value.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const data = require('../../../lib/map-data/facilities.json');

export async function GET() {
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
