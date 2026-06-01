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
import { fmtEmissions } from './aqiUtils';

interface PollutantRow {
  pollutant: string;
  count: number;
  totalEmissions: number;
  unit: string;
}

interface Props {
  data: PollutantRow[];
}

// Teal → purple gradient across bars
const BAR_COLORS = [
  '#1E9E8A',
  '#229690',
  '#268E96',
  '#2A869C',
  '#2E7EA2',
  '#5B6DB8',
  '#7060C2',
  '#8554CC',
  '#9B6FD4',
  '#B089DC',
];

const CustomTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: PollutantRow }>;
}) => {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  return (
    <div
      className="rounded border border-border-default bg-bg-terminal px-3 py-2 font-mono text-[11px] text-text-primary"
      style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.6)' }}
    >
      <div className="font-semibold text-accent-teal">{row.pollutant}</div>
      <div className="mt-1 text-text-secondary">
        Emissions:{' '}
        <span className="text-text-primary">{fmtEmissions(row.totalEmissions)}</span>
        {row.unit ? ` ${row.unit}` : ''}
      </div>
      <div className="text-text-muted">
        Facilities: <span className="text-text-secondary">{row.count.toLocaleString()}</span>
      </div>
    </div>
  );
};

export function PollutantChart({ data }: Props) {
  const unit = data[0]?.unit ?? '';

  return (
    <div className="flex flex-col gap-3">
      <div className="font-mono text-[10px] text-text-muted">
        Grouped by primary (first) pollutant · Source: EPA-GHGRP-2022 + EPA-ECHO-2024
        {unit && ` · Unit: ${unit}`}
      </div>

      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: 48 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border-subtle)"
              vertical={false}
            />
            <XAxis
              dataKey="pollutant"
              tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: '"JetBrains Mono", monospace' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-default)' }}
              angle={-35}
              textAnchor="end"
              interval={0}
            />
            <YAxis
              tickFormatter={(v: number) => fmtEmissions(v)}
              tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: '"JetBrains Mono", monospace' }}
              tickLine={false}
              axisLine={false}
              width={60}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(30,158,138,0.06)' }} />
            <Bar dataKey="totalEmissions" radius={[3, 3, 0, 0]}>
              {data.map((_, index) => (
                <Cell
                  key={index}
                  fill={BAR_COLORS[index % BAR_COLORS.length]}
                  fillOpacity={0.9}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
