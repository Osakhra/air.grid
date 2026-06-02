import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

// Pre-computed at build time: all 76 NWS wind observations.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const data = require('../../../lib/map-data/wind.json');

export async function GET() {
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  });
}
