'use client';

import React, { useState } from 'react';
import { aqiColor, aqiLabel, formatObservedAt } from './aqiUtils';

interface SensorRow {
  id: string;
  lat: number;
  lng: number;
  aqi: number;
  pm25: number | null;
  o3: number | null;
  observed_at: string;
  source: string;
}

interface Props {
  data: SensorRow[];
  generatedAt: string | null;
}

type SortKey = 'aqi' | 'pm25' | 'o3' | 'observed_at';

export function AqiLeaderboard({ data, generatedAt }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('aqi');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sorted = [...data].sort((a, b) => {
    const av = a[sortKey] ?? -Infinity;
    const bv = b[sortKey] ?? -Infinity;
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
    }
    return sortDir === 'desc'
      ? (bv as number) - (av as number)
      : (av as number) - (bv as number);
  });

  const SortHeader = ({ col, label }: { col: SortKey; label: string }) => (
    <th
      className="cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left font-body text-[11px] text-text-muted hover:text-text-secondary"
      onClick={() => toggleSort(col)}
    >
      {label}
      {sortKey === col && (
        <span className="ml-1 text-accent-teal">{sortDir === 'desc' ? '↓' : '↑'}</span>
      )}
    </th>
  );

  // Stale check: generatedAt older than 2 hours
  const ageMs = generatedAt ? Date.now() - new Date(generatedAt).getTime() : 0;
  const isStale = ageMs > 2 * 60 * 60 * 1000;

  return (
    <div className="flex flex-col gap-3">
      {/* Provenance bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          {isStale ? (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-warn" />
          ) : (
            <span className="live-dot" />
          )}
          <span
            className="font-mono text-[10px]"
            style={{ color: isStale ? 'var(--warn)' : 'var(--text-muted)' }}
          >
            {isStale ? 'DATA STALE' : 'LIVE'} · AirNow / PurpleAir / OpenAQ
          </span>
        </div>
        {generatedAt && (
          <span className="font-mono text-[10px] text-text-muted">
            file generated {new Date(generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border-default">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border-subtle bg-bg-tertiary">
              <th className="px-3 py-2 text-left font-body text-[11px] text-text-muted">#</th>
              <th className="px-3 py-2 text-left font-body text-[11px] text-text-muted">Sensor ID</th>
              <SortHeader col="aqi" label="AQI" />
              <th className="px-3 py-2 text-left font-body text-[11px] text-text-muted">Category</th>
              <SortHeader col="pm25" label="PM2.5 (µg/m³)" />
              <SortHeader col="o3" label="O₃ (ppb)" />
              <SortHeader col="observed_at" label="Observed" />
              <th className="px-3 py-2 text-left font-body text-[11px] text-text-muted">Source</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => {
              const color = aqiColor(row.aqi);
              const label = aqiLabel(row.aqi);
              const { display: obsDisplay, isStale: rowStale } = formatObservedAt(row.observed_at);

              return (
                <tr
                  key={row.id}
                  className="border-b border-border-subtle transition-colors hover:bg-bg-tertiary"
                >
                  <td className="px-3 py-2 font-mono text-[12px] text-text-muted">{i + 1}</td>
                  <td
                    className="max-w-[200px] truncate px-3 py-2 font-mono text-[12px] text-text-secondary"
                    title={row.id}
                  >
                    {row.id}
                  </td>
                  <td className="px-3 py-2 font-mono text-[13px] font-semibold" style={{ color }}>
                    {row.aqi}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px]" style={{ color }}>
                    {label}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] text-text-secondary">
                    {row.pm25 != null ? row.pm25.toFixed(1) : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] text-text-secondary">
                    {row.o3 != null ? row.o3.toFixed(1) : '—'}
                  </td>
                  <td
                    className="px-3 py-2 font-mono text-[11px]"
                    style={{ color: rowStale ? 'var(--warn)' : 'var(--text-muted)' }}
                    title={row.observed_at}
                  >
                    {rowStale && <span className="mr-1">⚠</span>}
                    {obsDisplay}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-text-muted">{row.source}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
