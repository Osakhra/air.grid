import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

// Pre-computed at build time: all sensor readings baked at last ETL run.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const data = require('../../../lib/map-data/sensors.json');

export async function GET() {
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  });
}
