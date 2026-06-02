import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

// Pre-computed at build time: top 20,000 schools by enrollment.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const data = require('../../../lib/map-data/schools.json');

export async function GET() {
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
