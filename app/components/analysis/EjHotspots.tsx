'use client';

import React, { useState } from 'react';
import { fmtEmissions, fmtNum } from './aqiUtils';

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

interface Props {
  data: EjRow[];
}

type SortKey = 'emissions_value' | 'pct_minority' | 'median_income';

function minorityColor(pct: number): string {
  if (pct >= 0.9) return '#E5484D';
  if (pct >= 0.75) return '#F5A524';
  return '#E6B547';
}

export function EjHotspots({ data }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('emissions_value');
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
        Filter: Census tracts with pct_minority &gt; 60% · Source: ACS 5-Year 2022 + EPA-GHGRP-2022
      </div>

      <div className="overflow-x-auto rounded-lg border border-border-default">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border-subtle bg-bg-tertiary">
              <th className="px-3 py-2 text-left font-body text-[11px] text-text-muted">#</th>
              <th className="px-3 py-2 text-left font-body text-[11px] text-text-muted">Facility</th>
              <th className="px-3 py-2 text-left font-body text-[11px] text-text-muted">Sector</th>
              <SortHeader col="emissions_value" label="Emissions" />
              <th className="px-3 py-2 text-left font-body text-[11px] text-text-muted">Unit</th>
              <SortHeader col="pct_minority" label="% Minority" />
              <SortHeader col="median_income" label="Median Income" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={row.facility_id}
                className="border-b border-border-subtle transition-colors hover:bg-bg-tertiary"
              >
                <td className="px-3 py-2 font-mono text-[12px] text-text-muted">{i + 1}</td>
                <td
                  className="max-w-[220px] truncate px-3 py-2 font-mono text-[12px] text-text-primary"
                  title={row.facility_name}
                >
                  {row.facility_name}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-text-muted">
                  {row.type || '—'}
                </td>
                <td className="px-3 py-2 font-mono text-[13px] font-semibold text-accent-teal">
                  {fmtEmissions(row.emissions_value)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[10px] text-text-muted">
                  {row.emissions_unit || '—'}
                </td>
                <td
                  className="px-3 py-2 font-mono text-[13px] font-semibold"
                  style={{ color: minorityColor(row.pct_minority) }}
                >
                  {(row.pct_minority * 100).toFixed(1)}%
                </td>
                <td className="px-3 py-2 font-mono text-[12px] text-text-secondary">
                  {row.median_income != null
                    ? `$${fmtNum(row.median_income)}`
                    : <span className="text-text-muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
