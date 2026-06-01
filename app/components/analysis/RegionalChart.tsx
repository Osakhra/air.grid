'use client';

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { fmtEmissions, fmtNum } from './aqiUtils';

interface RegionRow {
  region: string;
  totalEmissions: number;
  facilityCount: number;
  unit: string;
}

interface Props {
  data: RegionRow[];
}

const REGION_COLORS: Record<string, string> = {
  'Midwest':       '#1E9E8A',
  'Northeast':     '#2A86C2',
  'Southeast':     '#9B6FD4',
  'South Central': '#E6B547',
  'Pacific':       '#46A758',
  'Mountain West': '#F5A524',
  'Other':         '#7E8898',
};

const CustomTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: RegionRow }>;
}) => {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  return (
    <div
      className="rounded border border-border-default bg-bg-terminal px-3 py-2 font-mono text-[11px] text-text-primary"
      style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.6)' }}
    >
      <div className="font-semibold" style={{ color: REGION_COLORS[row.region] ?? '#1E9E8A' }}>
        {row.region}
      </div>
      <div className="mt-1 text-text-secondary">
        Total emissions:{' '}
        <span className="text-text-primary">{fmtEmissions(row.totalEmissions)}</span>
        {row.unit ? ` ${row.unit}` : ''}
      </div>
      <div className="text-text-muted">
        Facilities: <span className="text-text-secondary">{fmtNum(row.facilityCount)}</span>
      </div>
    </div>
  );
};

export function RegionalChart({ data }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="font-mono text-[10px] text-text-muted">
        Regions assigned by lat/lng bracket · Source: EPA-GHGRP-2022 + EPA-ECHO-2024
      </div>

      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 80, left: 100, bottom: 4 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border-subtle)"
              horizontal={false}
            />
            <XAxis
              type="number"
              tickFormatter={(v: number) => fmtEmissions(v)}
              tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: '"JetBrains Mono", monospace' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-default)' }}
            />
            <YAxis
              type="category"
              dataKey="region"
              tick={{ fill: 'var(--text-secondary)', fontSize: 12, fontFamily: '"JetBrains Mono", monospace' }}
              tickLine={false}
              axisLine={false}
              width={96}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(30,158,138,0.06)' }} />
            <Bar dataKey="totalEmissions" radius={[0, 3, 3, 0]}>
              {data.map((entry, index) => (
                <Cell
                  key={index}
                  fill={REGION_COLORS[entry.region] ?? '#1E9E8A'}
                  fillOpacity={0.85}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
