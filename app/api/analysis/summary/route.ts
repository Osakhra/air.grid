/**
 * GET /api/analysis/summary
 * Returns headline counts and averages derived from all data files.
 * Aggregated server-side; payload is tiny (~200 bytes).
 */

import { NextResponse } from 'next/server';
import {
  getFacilities,
  getSensors,
  getSchools,
  getSchoolExposure,
} from '@/app/lib/dataLoader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const facilities = await getFacilities();
    const sensors = await getSensors();
    const schools = await getSchools();
    const exposure = await getSchoolExposure();

    const facilityCount = facilities.features.length;
    const sensorCount = sensors.features.length;
    const schoolCount = schools.features.length;

    // Sensors with a non-null AQI reading
    const sensorsWithAqi = sensors.features.filter(
      (f) => f.properties.aqi !== null && f.properties.aqi !== undefined
    );
    const avgAqi =
      sensorsWithAqi.length > 0
        ? Math.round(
            sensorsWithAqi.reduce((sum, f) => sum + (f.properties.aqi as number), 0) /
              sensorsWithAqi.length
          )
        : null;

    const maxAqi =
      sensorsWithAqi.length > 0
        ? Math.max(...sensorsWithAqi.map((f) => f.properties.aqi as number))
        : null;

    // Schools that have at least one nearby facility (nearest_facility_ids non-empty)
    const schoolsNearEmitters = exposure.features.filter(
      (f) =>
        Array.isArray(f.properties.nearest_facility_ids) &&
        f.properties.nearest_facility_ids.length > 0
    ).length;

    // Schools flagged downwind
    const schoolsDownwind = exposure.features.filter(
      (f) => f.properties.is_downwind === true
    ).length;

    // Timestamp of the most recent sensor observation (proxy for "live" freshness)
    const latestObservedAt = sensors.features
      .map((f) => f.properties.observed_at)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

    const dataGeneratedAt =
      (sensors._meta?.generated_at as string | undefined) ??
      (sensors.metadata?.built_at as string | undefined) ??
      null;

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
    console.error('[analysis/summary] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
