'use client';

import React, { useState } from 'react';
import { fmtEmissions, fmtNum } from './aqiUtils';

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

interface Props {
  data: SchoolRow[];
}

type SortKey = 'max_emissions_nearby' | 'enrollment' | 'nearest_aqi';

export function MostExposedSchools({ data }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('max_emissions_nearby');
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
    const av = (a[sortKey] ?? -Infinity) as number;
    const bv = (b[sortKey] ?? -Infinity) as number;
    return sortDir === 'desc' ? bv - av : av - bv;
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

  return (
    <div className="flex flex-col gap-3">
      <div className="font-mono text-[10px] text-text-muted">
        Source: geo-matcher join (NCES/IPEDS schools + EPA facilities within 10 km radius)
      </div>

      <div className="overflow-x-auto rounded-lg border border-border-default">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border-subtle bg-bg-tertiary">
              <th className="px-3 py-2 text-left font-body text-[11px] text-text-muted">#</th>
              <th className="px-3 py-2 text-left font-body text-[11px] text-text-muted">School</th>
              <th className="px-3 py-2 text-left font-body text-[11px] text-text-muted">Level</th>
              <SortHeader col="enrollment" label="Enrollment" />
              <SortHeader col="max_emissions_nearby" label="Max Nearby Emissions" />
              <SortHeader col="nearest_aqi" label="AQI" />
              <th className="px-3 py-2 text-left font-body text-[11px] text-text-muted">Downwind</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={row.school_id}
                className="border-b border-border-subtle transition-colors hover:bg-bg-tertiary"
              >
                <td className="px-3 py-2 font-mono text-[12px] text-text-muted">{i + 1}</td>
                <td
                  className="max-w-[220px] truncate px-3 py-2 font-mono text-[12px] text-text-primary"
                  title={row.school_name}
                >
                  {row.school_name}
                </td>
                <td className="px-3 py-2">
                  <span
                    className="status-pill"
                    style={
                      row.level === 'k12'
                        ? {
                            background: 'rgba(30,158,138,0.12)',
                            border: '1px solid rgba(30,158,138,0.3)',
                            color: 'var(--accent-teal)',
                          }
                        : {
                            background: 'rgba(91,45,142,0.15)',
                            border: '1px solid rgba(91,45,142,0.4)',
                            color: 'var(--accent-purple-bright)',
                          }
                    }
                  >
                    {row.level === 'k12' ? 'K-12' : row.level === 'college' ? 'College' : row.level}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-[12px] text-text-secondary">
                  {row.enrollment != null ? fmtNum(row.enrollment) : '—'}
                </td>
                <td className="px-3 py-2 font-mono text-[13px] font-semibold text-accent-teal">
                  {fmtEmissions(row.max_emissions_nearby)}
                </td>
                <td className="px-3 py-2 font-mono text-[12px] text-text-secondary">
                  {row.nearest_aqi != null ? row.nearest_aqi : '—'}
                </td>
                <td className="px-3 py-2 font-mono text-[12px]">
                  {row.is_downwind ? (
                    <span style={{ color: 'var(--warn)' }}>Yes</span>
                  ) : (
                    <span className="text-text-muted">No</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
