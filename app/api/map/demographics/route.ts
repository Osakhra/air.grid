import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

// Pre-computed at build time: 15,000 sampled census-tract centroids.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const data = require('../../../lib/map-data/demographics.json');

export async function GET() {
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
  });
}
