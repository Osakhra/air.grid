import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function GET() {
  try {
    const res = await fetch(`${BASE_URL}/analysis/pollutant-breakdown.json`, {
      next: { revalidate: 86400 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return NextResponse.json(await res.json());
  } catch (err) {
    console.error('[analysis/pollutant-breakdown]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
