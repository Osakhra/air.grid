/**
 * GET /api/analysis/most-exposed-schools
 * Returns top 20 schools by max_emissions_nearby from the school_exposure join,
 * enriched with enrollment and level from the schools file.
 */

import { NextResponse } from 'next/server';
import { getSchoolExposure, getSchools } from '@/app/lib/dataLoader';

export const runtime = 'nodejs';
export const revalidate = 3600;

export async function GET() {
  try {
    const exposure = getSchoolExposure();
    const schools = getSchools();

    // Build a lookup: school_id -> { level, enrollment }
    const schoolMeta: Record<string, { level: string; enrollment: number | null }> = {};
    for (const f of schools.features) {
      schoolMeta[f.properties.id] = {
        level: f.properties.level ?? 'unknown',
        enrollment: f.properties.enrollment ?? null,
      };
    }

    const top20 = exposure.features
      .filter((f) => (f.properties.max_emissions_nearby ?? 0) > 0)
      .sort((a, b) => b.properties.max_emissions_nearby - a.properties.max_emissions_nearby)
      .slice(0, 20)
      .map((f) => {
        const meta = schoolMeta[f.properties.school_id] ?? { level: 'unknown', enrollment: null };
        return {
          school_id: f.properties.school_id,
          school_name: f.properties.school_name,
          lat: f.properties.lat,
          lng: f.properties.lng,
          level: meta.level,
          enrollment: meta.enrollment,
          max_emissions_nearby: f.properties.max_emissions_nearby,
          nearest_aqi: f.properties.nearest_aqi,
          is_downwind: f.properties.is_downwind,
          nearest_sensor_distance_m: f.properties.nearest_sensor_distance_m,
          source: f.properties.source,
        };
      });

    return NextResponse.json(top20);
  } catch (err) {
    console.error('[analysis/most-exposed-schools] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
