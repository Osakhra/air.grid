/**
 * app/analysis/page.tsx
 * =====================
 * Next.js Server Component — Grid Analysis dashboard.
 *
 * All data is fetched server-side from the /api/analysis/* routes, which in turn
 * read from the same /data/*.geojson files the map uses. No raw GeoJSON is sent
 * to the browser. Payloads are aggregated to <50 KB total.
 *
 * Sections:
 *   1. Header + live stat tiles
 *   2. Live AQI leaderboard
 *   3. Top polluters table
 *   4. Pollutant mix bar chart
 *   5. Most-exposed schools table
 *   6. Environmental justice hotspots
 *   7. Regional emissions breakdown
 */

import React from 'react';
import { AqiLeaderboard } from '@/app/components/analysis/AqiLeaderboard';
import { TopPolluters } from '@/app/components/analysis/TopPolluters';
import { PollutantChart } from '@/app/components/analysis/PollutantChart';
import { MostExposedSchools } from '@/app/components/analysis/MostExposedSchools';
import { EjHotspots } from '@/app/components/analysis/EjHotspots';
import { RegionalChart } from '@/app/components/analysis/RegionalChart';
import { StatCard } from '@/app/components/analysis/StatCard';
import { formatObservedAt, fmtNum, fmtEmissions } from '@/app/components/analysis/aqiUtils';

// Force server-rendering on every request so the API routes are live when
// the page renders. Static pre-generation at build time has no running server,
// which causes all self-fetches to ECONNREFUSED and every section to show empty.
export const dynamic = 'force-dynamic';

// ── Fetch helpers (server-side) ───────────────────────────────────────────────

const BASE_URL =
  process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      console.error(`[analysis/page] ${path} → HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[analysis/page] ${path} error:`, err);
    return null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Summary {
  facilityCount: number;
  sensorCount: number;
  schoolCount: number;
  schoolsNearEmitters: number;
  schoolsDownwind: number;
  avgAqi: number | null;
  maxAqi: number | null;
  sensorsWithAqiCount: number;
  latestObservedAt: string | null;
  dataGeneratedAt: string | null;
  sources: string[];
}

interface AqiRow {
  id: string;
  lat: number;
  lng: number;
  aqi: number;
  pm25: number | null;
  o3: number | null;
  observed_at: string;
  source: string;
}

interface AqiLeaderboardPayload {
  data: AqiRow[];
  generatedAt: string | null;
}

interface FacilityRow {
  id: string;
  name: string;
  type: string;
  emissions_value: number;
  emissions_unit: string;
  pollutants: string[];
  source: string;
}

interface PollutantRow {
  pollutant: string;
  count: number;
  totalEmissions: number;
  unit: string;
}

interface SchoolRow {
  school_id: string;
  school_name: string;
  level: string;
  enrollment: number | null;
  max_emissions_nearby: number;
  nearest_aqi: number | null;
  is_downwind: boolean;
  source: string;
}

interface EjRow {
  facility_id: string;
  facility_name: string;
  type: string;
  emissions_value: number;
  emissions_unit: string;
  pct_minority: number;
  median_income: number | null;
  population: number | null;
  source: string;
}

interface RegionRow {
  region: string;
  totalEmissions: number;
  facilityCount: number;
  unit: string;
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  id,
  title,
  badge,
  children,
}: {
  id: string;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl font-semibold text-text-primary">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AnalysisPage() {
  // Fetch all sections in parallel
  const [summary, aqiPayload, topPolluters, pollutantBreakdown, exposedSchools, ejHotspots, regional] =
    await Promise.all([
      fetchJson<Summary>('/api/analysis/summary'),
      fetchJson<AqiLeaderboardPayload>('/api/analysis/aqi-leaderboard'),
      fetchJson<FacilityRow[]>('/api/analysis/top-polluters'),
      fetchJson<PollutantRow[]>('/api/analysis/pollutant-breakdown'),
      fetchJson<SchoolRow[]>('/api/analysis/most-exposed-schools'),
      fetchJson<EjRow[]>('/api/analysis/ej-hotspots'),
      fetchJson<RegionRow[]>('/api/analysis/regional-breakdown'),
    ]);

  // Freshness check on sensor data
  const sensorAge = summary?.latestObservedAt
    ? Date.now() - new Date(summary.latestObservedAt).getTime()
    : 0;
  const sensorStale = sensorAge > 2 * 60 * 60 * 1000;

  const latestDisplay = summary?.latestObservedAt
    ? formatObservedAt(summary.latestObservedAt).display
    : null;

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div
        className="border-b border-border-subtle"
        style={{ background: 'linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)' }}
      >
        <div className="section-container py-10">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="status-pill status-shipped">
                  <span className="live-dot" />
                  LIVE DATA
                </span>
                <span className="font-mono text-[10px] text-text-muted">
                  Phase 3 · analysis-dashboard
                </span>
              </div>
              <h1 className="font-display text-4xl font-bold tracking-tight text-text-primary">
                Grid Analysis
              </h1>
              <p className="mt-2 font-body text-base text-text-muted">
                U.S. air quality &middot; industrial emissions &middot; environmental justice
              </p>
            </div>

            {/* Data provenance strip */}
            <div className="flex flex-col gap-1 text-right">
              <span className="font-mono text-[10px] text-text-muted">
                Sources: EPA-GHGRP-2022, EPA-ECHO-2024, AirNow, PurpleAir, OpenAQ, NCES, IPEDS, ACS 5-Year 2022
              </span>
              {latestDisplay && (
                <span
                  className="font-mono text-[10px]"
                  style={{ color: sensorStale ? 'var(--warn)' : 'var(--text-muted)' }}
                >
                  {sensorStale ? 'STALE — ' : 'Live sensor as of '}
                  {latestDisplay}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Stat tiles ───────────────────────────────────────────────────────── */}
      <div className="section-container py-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard
            label="Facilities tracked"
            value={summary ? fmtNum(summary.facilityCount) : '—'}
            sub="EPA-GHGRP-2022 + EPA-ECHO-2024"
          />
          <StatCard
            label="Sensors live"
            value={summary ? fmtNum(summary.sensorCount) : '—'}
            sub={`${summary?.sensorsWithAqiCount ?? 0} with AQI reading`}
            live
            isStale={sensorStale}
            timestamp={latestDisplay ?? undefined}
          />
          <StatCard
            label="National avg AQI"
            value={summary?.avgAqi != null ? summary.avgAqi : '—'}
            accent={
              summary?.avgAqi == null
                ? 'teal'
                : summary.avgAqi <= 50
                ? 'teal'
                : summary.avgAqi <= 100
                ? 'gold'
                : 'danger'
            }
            live
            isStale={sensorStale}
            timestamp={latestDisplay ?? undefined}
          />
          <StatCard
            label="Schools near emitters"
            value={summary ? fmtNum(summary.schoolsNearEmitters) : '—'}
            sub={`of ${summary ? fmtNum(summary.schoolCount) : '?'} total`}
          />
          <StatCard
            label="Schools flagged downwind"
            value={summary ? fmtNum(summary.schoolsDownwind) : '—'}
            accent="warn"
            sub="within 10 km of facility"
          />
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div className="section-container space-y-10 pb-16">

        {/* Section 2: AQI Leaderboard */}
        <Section
          id="aqi-leaderboard"
          title="Live AQI Leaderboard"
          badge={
            <span className="status-pill status-shipped">
              <span className="live-dot" />
              top 20 worst readings
            </span>
          }
        >
          {aqiPayload?.data && aqiPayload.data.length > 0 ? (
            <AqiLeaderboard data={aqiPayload.data} generatedAt={aqiPayload.generatedAt} />
          ) : (
            <EmptyState message="No AQI data available — sensors file may be stale or missing." />
          )}
        </Section>

        {/* Section 3: Top Polluters */}
        <Section
          id="top-polluters"
          title="Top 20 Emitters"
          badge={
            <span className="status-pill" style={{ background: 'rgba(229,72,77,0.1)', border: '1px solid rgba(229,72,77,0.3)', color: 'var(--danger)' }}>
              by reported emissions
            </span>
          }
        >
          {topPolluters && topPolluters.length > 0 ? (
            <TopPolluters data={topPolluters} />
          ) : (
            <EmptyState message="Emissions data unavailable." />
          )}
        </Section>

        {/* Section 4: Pollutant mix */}
        <Section
          id="pollutant-mix"
          title="National Pollutant Mix"
          badge={
            <span className="font-mono text-[11px] text-text-muted">top 10 by total reported emissions</span>
          }
        >
          <div className="rounded-lg border border-border-default bg-bg-secondary p-4">
            {pollutantBreakdown && pollutantBreakdown.length > 0 ? (
              <PollutantChart data={pollutantBreakdown} />
            ) : (
              <EmptyState message="Pollutant breakdown unavailable." />
            )}
          </div>
        </Section>

        {/* Section 5: Most Exposed Schools */}
        <Section
          id="exposed-schools"
          title="Most-Exposed Campuses"
          badge={
            <span className="status-pill status-progress">
              top 20 by nearby emissions
            </span>
          }
        >
          {exposedSchools && exposedSchools.length > 0 ? (
            <MostExposedSchools data={exposedSchools} />
          ) : (
            <EmptyState message="School exposure data unavailable." />
          )}
        </Section>

        {/* Section 6: EJ Hotspots */}
        <Section
          id="ej-hotspots"
          title="Environmental Justice Hotspots"
          badge={
            <span className="status-pill" style={{ background: 'rgba(245,165,36,0.1)', border: '1px solid rgba(245,165,36,0.3)', color: 'var(--warn)' }}>
              majority-minority tracts (pct_minority &gt; 60%)
            </span>
          }
        >
          {ejHotspots && ejHotspots.length > 0 ? (
            <EjHotspots data={ejHotspots} />
          ) : (
            <EmptyState message="EJ hotspot data unavailable." />
          )}
        </Section>

        {/* Section 7: Regional breakdown */}
        <Section
          id="regional-breakdown"
          title="Regional Emissions Breakdown"
          badge={
            <span className="font-mono text-[11px] text-text-muted">total facility emissions by US region</span>
          }
        >
          <div className="rounded-lg border border-border-default bg-bg-secondary p-4">
            {regional && regional.length > 0 ? (
              <RegionalChart data={regional} />
            ) : (
              <EmptyState message="Regional breakdown unavailable." />
            )}
          </div>
        </Section>

        {/* Footer provenance note */}
        <div className="border-t border-border-subtle pt-6">
          <p className="font-mono text-[10px] leading-relaxed text-text-muted">
            Data provenance: facilities — EPA Greenhouse Gas Reporting Program (GHGRP) 2022 + EPA ECHO air permit database 2024 (268,980 records).
            Sensors — AirNow (EPA official), PurpleAir (EPA-corrected PM2.5), OpenAQ (15,897 sensors at last refresh).
            Schools — NCES EDGE Geocode + CCD Membership 2022-23, IPEDS HD2022 + EFFY2022 (108,336 institutions).
            Demographics — ACS 5-Year 2022 (84,539 Census tracts).
            Geospatial joins — scipy cKDTree, 10 km facility radius, 50 km sensor radius, 2026-06-01.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Empty state helper ────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-border-subtle bg-bg-secondary px-6 py-10 text-center">
      <p className="font-mono text-[12px] text-text-muted">{message}</p>
    </div>
  );
}
