import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function GET() {
  try {
    // Fetch all four files in parallel. Facilities/schools/exposure are static at
    // deploy time and use the shared 24-hour cache. Sensors are live (no-store).
    const [facRes, senRes, schRes, expRes] = await Promise.all([
      fetch(`${BASE_URL}/data/facilities.geojson`,              { next: { revalidate: 86400 } }),
      fetch(`${BASE_URL}/data/sensors.geojson`,                 { cache: 'no-store' }),
      fetch(`${BASE_URL}/data/schools.geojson`,                 { next: { revalidate: 86400 } }),
      fetch(`${BASE_URL}/data/joins/school_exposure.geojson`,   { next: { revalidate: 86400 } }),
    ]);

    if (!facRes.ok) throw new Error(`facilities HTTP ${facRes.status}`);
    if (!senRes.ok) throw new Error(`sensors HTTP ${senRes.status}`);
    if (!schRes.ok) throw new Error(`schools HTTP ${schRes.status}`);
    if (!expRes.ok) throw new Error(`school_exposure HTTP ${expRes.status}`);

    const [facilities, sensors, schools, exposure] = await Promise.all([
      facRes.json(), senRes.json(), schRes.json(), expRes.json(),
    ]);

    const facilityCount  = (facilities.features ?? []).length;
    const sensorCount    = (sensors.features ?? []).length;
    const schoolCount    = (schools.features ?? []).length;

    const sensorsWithAqi = (sensors.features ?? []).filter(
      (f: any) => f.properties?.aqi != null,
    );
    const avgAqi = sensorsWithAqi.length > 0
      ? Math.round(sensorsWithAqi.reduce((s: number, f: any) => s + f.properties.aqi, 0) / sensorsWithAqi.length)
      : null;
    const maxAqi = sensorsWithAqi.length > 0
      ? Math.max(...sensorsWithAqi.map((f: any) => f.properties.aqi as number))
      : null;

    const schoolsNearEmitters = (exposure.features ?? []).filter(
      (f: any) => Array.isArray(f.properties?.nearest_facility_ids) && f.properties.nearest_facility_ids.length > 0,
    ).length;

    const schoolsDownwind = (exposure.features ?? []).filter(
      (f: any) => f.properties?.is_downwind === true,
    ).length;

    const latestObservedAt = (sensors.features ?? [])
      .map((f: any) => f.properties?.observed_at)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

    const dataGeneratedAt: string | null =
      sensors._meta?.generated_at ?? sensors.metadata?.built_at ?? null;

    return NextResponse.json({
      facilityCount,
      sensorCount,
      schoolCount,
      schoolsNearEmitters,
      schoolsDownwind,
      avgAqi,
      maxAqi,
      sensorsWithAqiCount: sensorsWithAqi.length,
      latestObservedAt,
      dataGeneratedAt,
      sources: ['EPA-GHGRP-2022', 'EPA-ECHO-2024', 'AirNow', 'PurpleAir', 'OpenAQ', 'NCES', 'IPEDS'],
    });
  } catch (err) {
    console.error('[analysis/summary]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
