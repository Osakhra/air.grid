/**
 * scripts/precompute-analysis.js
 * ================================
 * Runs at build time (node, not serverless). Reads the committed GeoJSON
 * files from public/data/ with fs, computes every analysis aggregation,
 * and writes small JSON files to app/lib/analysis-data/.
 *
 * API routes import these files directly (resolveJsonModule) and export
 * them as force-static route handlers — no HTTP self-fetch, no 401 from
 * Vercel deployment protection, no serverless function needed at runtime.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
// Write to app/lib/analysis-data/ so routes can import directly (no HTTP self-fetch).
// Also write to public/analysis/ so the files are accessible as CDN assets if needed.
const OUT_LIB = path.join(__dirname, '..', 'app', 'lib', 'analysis-data');
const OUT_PUB = path.join(__dirname, '..', 'public', 'analysis');

fs.mkdirSync(OUT_LIB, { recursive: true });
fs.mkdirSync(OUT_PUB, { recursive: true });

function read(relPath) {
  const abs = path.join(DATA, relPath);
  console.log(`  reading ${path.relative(path.join(__dirname, '..'), abs)}`);
  return JSON.parse(fs.readFileSync(abs, 'utf-8'));
}

function write(name, data) {
  const json = JSON.stringify(data);
  fs.writeFileSync(path.join(OUT_LIB, name), json, 'utf-8');
  fs.writeFileSync(path.join(OUT_PUB, name), json, 'utf-8');
  const kb = Math.round(Buffer.byteLength(json) / 1024);
  console.log(`  wrote   app/lib/analysis-data/${name} + public/analysis/${name} (${kb} KB)`);
}

console.log('\nprecompute-analysis: loading GeoJSON files…');
const fac = read('facilities.geojson');
const sen = read('sensors.geojson');
const sch = read('schools.geojson');
const exp = read('joins/school_exposure.geojson');
const dem = read('joins/facility_demographics.geojson');
console.log('  all files loaded\n');

// ── top-polluters ─────────────────────────────────────────────────────────────
const topPolluters = fac.features
  .filter(f => (f.properties.emissions_value ?? 0) > 0)
  .sort((a, b) => b.properties.emissions_value - a.properties.emissions_value)
  .slice(0, 20)
  .map(f => ({
    id:              f.properties.id,
    name:            f.properties.name,
    type:            f.properties.type,
    lat:             f.properties.lat,
    lng:             f.properties.lng,
    emissions_value: f.properties.emissions_value,
    emissions_unit:  f.properties.emissions_unit,
    pollutants:      f.properties.pollutants ?? [],
    source:          f.properties.source,
  }));
write('top-polluters.json', topPolluters);

// ── pollutant-breakdown ───────────────────────────────────────────────────────
const byPollutant = {};
for (const f of fac.features) {
  const { pollutants, emissions_value, emissions_unit } = f.properties;
  const primary = Array.isArray(pollutants) && pollutants.length > 0
    ? String(pollutants[0]) : 'Unknown';
  if (!byPollutant[primary]) byPollutant[primary] = { count: 0, totalEmissions: 0, unit: emissions_unit ?? '' };
  byPollutant[primary].count++;
  byPollutant[primary].totalEmissions += emissions_value ?? 0;
}
const pollutantBreakdown = Object.entries(byPollutant)
  .map(([pollutant, d]) => ({ pollutant, ...d }))
  .sort((a, b) => b.totalEmissions - a.totalEmissions)
  .slice(0, 10);
write('pollutant-breakdown.json', pollutantBreakdown);

// ── regional-breakdown ────────────────────────────────────────────────────────
function assignRegion(lat, lng) {
  if (lng < -115) return 'Pacific';
  if (lng < -105) return 'Mountain West';
  if (lng < -95)  return 'South Central';
  if (lng < -75 && lat >= 37) return 'Midwest';
  if (lng < -75 && lat < 37)  return 'Southeast';
  if (lng >= -80 && lat > 37) return 'Northeast';
  return 'Other';
}
const regionMap = {};
for (const f of fac.features) {
  const { lat, lng, emissions_value, emissions_unit } = f.properties;
  if (lat == null || lng == null) continue;
  const r = assignRegion(lat, lng);
  if (!regionMap[r]) regionMap[r] = { totalEmissions: 0, facilityCount: 0, unit: '' };
  regionMap[r].totalEmissions += emissions_value ?? 0;
  regionMap[r].facilityCount++;
  if (!regionMap[r].unit && emissions_unit) regionMap[r].unit = emissions_unit;
}
const regionalBreakdown = Object.entries(regionMap)
  .map(([region, d]) => ({ region, ...d }))
  .filter(r => r.facilityCount > 0)
  .sort((a, b) => b.totalEmissions - a.totalEmissions);
write('regional-breakdown.json', regionalBreakdown);

// ── most-exposed-schools ──────────────────────────────────────────────────────
const schoolMeta = {};
for (const f of sch.features) {
  schoolMeta[f.properties.id] = {
    level:      f.properties.level ?? 'unknown',
    enrollment: f.properties.enrollment ?? null,
  };
}
const mostExposedSchools = exp.features
  .filter(f => (f.properties.max_emissions_nearby ?? 0) > 0)
  .sort((a, b) => b.properties.max_emissions_nearby - a.properties.max_emissions_nearby)
  .slice(0, 20)
  .map(f => {
    const meta = schoolMeta[f.properties.school_id] ?? { level: 'unknown', enrollment: null };
    return {
      school_id:                f.properties.school_id,
      school_name:              f.properties.school_name,
      lat:                      f.properties.lat,
      lng:                      f.properties.lng,
      level:                    meta.level,
      enrollment:               meta.enrollment,
      max_emissions_nearby:     f.properties.max_emissions_nearby,
      nearest_aqi:              f.properties.nearest_aqi ?? null,
      is_downwind:              f.properties.is_downwind ?? false,
      nearest_sensor_distance_m: f.properties.nearest_sensor_distance_m ?? null,
      source:                   f.properties.source,
    };
  });
write('most-exposed-schools.json', mostExposedSchools);

// ── ej-hotspots ───────────────────────────────────────────────────────────────
const emissionsById = {};
for (const f of fac.features) {
  emissionsById[f.properties.id] = {
    emissions_value: f.properties.emissions_value ?? 0,
    emissions_unit:  f.properties.emissions_unit ?? '',
    type:            f.properties.type ?? '',
  };
}
const ejHotspots = dem.features
  .filter(f => (f.properties.pct_minority ?? 0) > 0.6)
  .map(f => {
    const em = emissionsById[f.properties.facility_id] ?? { emissions_value: 0, emissions_unit: '', type: '' };
    return {
      facility_id:     f.properties.facility_id,
      facility_name:   f.properties.facility_name,
      lat:             f.properties.lat,
      lng:             f.properties.lng,
      type:            em.type,
      emissions_value: em.emissions_value,
      emissions_unit:  em.emissions_unit,
      pct_minority:    f.properties.pct_minority,
      median_income:   f.properties.median_income ?? null,
      population:      f.properties.population ?? null,
      geoid:           f.properties.geoid,
      source:          f.properties.source,
    };
  })
  .sort((a, b) => b.emissions_value - a.emissions_value)
  .slice(0, 20);
write('ej-hotspots.json', ejHotspots);

// ── aqi-leaderboard ───────────────────────────────────────────────────────────
const aqiTop20 = sen.features
  .filter(f => f.properties.aqi != null)
  .sort((a, b) => b.properties.aqi - a.properties.aqi)
  .slice(0, 20)
  .map(f => ({
    id:          f.properties.id,
    lat:         f.properties.lat,
    lng:         f.properties.lng,
    aqi:         f.properties.aqi,
    pm25:        f.properties.pm25 ?? null,
    o3:          f.properties.o3 ?? null,
    observed_at: f.properties.observed_at,
    source:      f.properties.source,
  }));
const generatedAt = sen._meta?.generated_at ?? sen.metadata?.built_at ?? null;
write('aqi-leaderboard.json', { data: aqiTop20, generatedAt });

// ── summary ───────────────────────────────────────────────────────────────────
const sensorsWithAqi = sen.features.filter(f => f.properties.aqi != null);
const summary = {
  facilityCount:       fac.features.length,
  sensorCount:         sen.features.length,
  schoolCount:         sch.features.length,
  schoolsNearEmitters: exp.features.filter(
    f => Array.isArray(f.properties.nearest_facility_ids) && f.properties.nearest_facility_ids.length > 0
  ).length,
  schoolsDownwind:     exp.features.filter(f => f.properties.is_downwind === true).length,
  avgAqi: sensorsWithAqi.length > 0
    ? Math.round(sensorsWithAqi.reduce((s, f) => s + f.properties.aqi, 0) / sensorsWithAqi.length)
    : null,
  maxAqi: sensorsWithAqi.length > 0
    ? Math.max(...sensorsWithAqi.map(f => f.properties.aqi))
    : null,
  sensorsWithAqiCount: sensorsWithAqi.length,
  latestObservedAt:    sen.features.map(f => f.properties.observed_at).filter(Boolean).sort().at(-1) ?? null,
  dataGeneratedAt:     sen._meta?.generated_at ?? sen.metadata?.built_at ?? null,
  sources:             ['EPA-GHGRP-2022', 'EPA-ECHO-2024', 'AirNow', 'PurpleAir', 'OpenAQ', 'NCES', 'IPEDS'],
};
write('summary.json', summary);

console.log('\nprecompute-analysis: done.\n');
