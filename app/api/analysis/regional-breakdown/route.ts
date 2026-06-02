import { NextResponse } from 'next/server';
import data from '@/app/lib/analysis-data/regional-breakdown.json';

export const dynamic = 'force-static';

export async function GET() {
  return NextResponse.json(data);
}
