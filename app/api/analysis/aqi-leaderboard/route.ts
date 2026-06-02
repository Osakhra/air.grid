import { NextResponse } from 'next/server';
import data from '@/app/lib/analysis-data/aqi-leaderboard.json';

export const dynamic = 'force-static';

export async function GET() {
  return NextResponse.json(data);
}
