'use client';

import React, { useState } from 'react';
import { fmtEmissions } from './aqiUtils';

interface FacilityRow {
  id: string;
  name: string;
  type: string;
  emissions_value: number;
  emissions_unit: string;
  pollutants: string[];
  source: string;
}

interface Props {
  data: FacilityRow[];
}

type SortKey = 'emissions_value' | 'name' | 'type';

export function TopPolluters({ data }: Props) {
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
    const av = a[sortKey];
    const bv = b[sortKey];
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-text-muted">
          Source: EPA-GHGRP-2022 · metric tons CO₂e/year · click column headers to sort
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border-default">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border-subtle bg-bg-tertiary">
              <th className="px-3 py-2 text-left font-body text-[11px] text-text-muted">#</th>
              <SortHeader col="name" label="Facility" />
              <SortHeader col="type" label="Sector" />
              <SortHeader col="emissions_value" label="Emissions" />
              <th className="px-3 py-2 text-left font-body text-[11px] text-text-muted">Unit</th>
              <th className="px-3 py-2 text-left font-body text-[11px] text-text-muted">Primary Pollutant</th>
              <th className="px-3 py-2 text-left font-body text-[11px] text-text-muted">Source</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={row.id}
                className="border-b border-border-subtle transition-colors hover:bg-bg-tertiary"
              >
                <td className="px-3 py-2 font-mono text-[12px] text-text-muted">{i + 1}</td>
                <td
                  className="max-w-[260px] truncate px-3 py-2 font-mono text-[12px] text-text-primary"
                  title={row.name}
                >
                  {row.name}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-text-muted">
                  {row.type}
                </td>
                <td className="px-3 py-2 font-mono text-[13px] font-semibold text-accent-teal">
                  {fmtEmissions(row.emissions_value)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[10px] text-text-muted">
                  {row.emissions_unit}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-text-secondary">
                  {Array.isArray(row.pollutants) && row.pollutants.length > 0
                    ? row.pollutants[0]
                    : '—'}
                </td>
                <td className="px-3 py-2 font-mono text-[10px] text-text-muted">{row.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
