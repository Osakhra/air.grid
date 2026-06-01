'use client';

import { TooltipState } from './types';
import { aqiLabel } from './colors';

interface Props {
  tooltip: TooltipState | null;
}

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex items-start justify-between gap-3 min-w-0">
      <span className="font-mono text-[10px] text-text-muted shrink-0 uppercase tracking-wide">
        {label}
      </span>
      <span className="font-mono text-[11px] text-text-primary text-right break-all">
        {String(value)}
      </span>
    </div>
  );
}

export default function MapTooltip({ tooltip }: Props) {
  if (!tooltip) return null;

  const { x, y, object } = tooltip;

  // Clamp to viewport so the card never overflows
  const LEFT_OFFSET = 14;
  const TOP_OFFSET = 14;
  const CARD_W = 220;
  const CARD_H = 180; // estimated max height
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  const left = x + LEFT_OFFSET + CARD_W > vw ? x - CARD_W - LEFT_OFFSET : x + LEFT_OFFSET;
  const top  = y + TOP_OFFSET + CARD_H > vh ? y - CARD_H - TOP_OFFSET : y + TOP_OFFSET;

  let title = '';
  let rows: Array<{ label: string; value: string | number | null | undefined }> = [];

  if (object.kind === 'facility') {
    const p = object.props;
    title = p.name;
    rows = [
      { label: 'Type',      value: p.type },
      { label: 'Operator',  value: p.operator },
      { label: 'Emissions', value: p.emissions_value != null ? `${p.emissions_value.toLocaleString()} ${p.emissions_unit}` : null },
      { label: 'Pollutants', value: p.pollutants?.join(', ') },
      { label: 'Year',      value: p.year },
      { label: 'Source',    value: p.source },
    ];
  } else if (object.kind === 'sensor') {
    const p = object.props;
    title = p.id.replace(/^(airnow|purpleair|openaq)-/, '');
    rows = [
      { label: 'AQI',         value: p.aqi != null ? `${p.aqi} — ${aqiLabel(p.aqi)}` : null },
      { label: 'PM2.5',       value: p.pm25 != null ? `${p.pm25} µg/m³` : null },
      { label: 'O3',          value: p.o3 != null ? `${p.o3} ppb` : null },
      { label: 'Observed',    value: p.observed_at ? new Date(p.observed_at).toLocaleString() : null },
      { label: 'Source',      value: p.source },
    ];
  } else if (object.kind === 'school') {
    const p = object.props;
    title = p.name;
    rows = [
      { label: 'Level',       value: p.level === 'k12' ? 'K-12' : 'College / University' },
      { label: 'Enrollment',  value: p.enrollment != null ? p.enrollment.toLocaleString() : null },
      { label: 'Source',      value: p.source },
    ];
  } else if (object.kind === 'wind') {
    const p = object.props;
    title = p.cell_id;
    rows = [
      { label: 'Speed',    value: `${p.speed_mps} m/s` },
      { label: 'Direction', value: `${p.dir_deg}°` },
      { label: 'Observed', value: p.observed_at ? new Date(p.observed_at).toLocaleString() : null },
      { label: 'Source',   value: p.source },
    ];
  } else if (object.kind === 'demo') {
    const p = object.props;
    title = `Census Tract ${p.geoid}`;
    rows = [
      { label: 'Population',     value: p.population?.toLocaleString() },
      { label: 'Median Income',  value: p.median_income != null ? `$${p.median_income.toLocaleString()}` : 'Suppressed' },
      { label: 'Pct Minority',   value: `${(p.pct_minority * 100).toFixed(1)}%` },
      { label: 'Source',         value: p.source },
    ];
  }

  return (
    <div
      className="pointer-events-none fixed z-40 w-[220px] rounded-lg border border-border-default shadow-2xl"
      style={{
        left,
        top,
        background: 'rgba(13, 17, 23, 0.96)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="border-b border-border-subtle px-3 py-2">
        <p className="font-body text-[12px] font-medium text-text-primary leading-snug line-clamp-2">
          {title}
        </p>
        {object.kind === 'facility' && (
          <span
            className="mt-0.5 inline-block rounded-sm px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider"
            style={{ background: 'rgba(30,158,138,0.15)', color: 'var(--accent-teal)' }}
          >
            facility
          </span>
        )}
        {object.kind === 'sensor' && (
          <span
            className="mt-0.5 inline-block rounded-sm px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider"
            style={{ background: 'rgba(70,167,88,0.15)', color: '#46A758' }}
          >
            sensor
          </span>
        )}
        {object.kind === 'school' && (
          <span
            className="mt-0.5 inline-block rounded-sm px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider"
            style={{ background: 'rgba(30,158,138,0.15)', color: 'var(--accent-teal)' }}
          >
            {object.props.level === 'k12' ? 'K-12 School' : 'College'}
          </span>
        )}
        {object.kind === 'wind' && (
          <span
            className="mt-0.5 inline-block rounded-sm px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider"
            style={{ background: 'rgba(30,158,138,0.12)', color: 'var(--accent-teal)' }}
          >
            wind station
          </span>
        )}
        {object.kind === 'demo' && (
          <span
            className="mt-0.5 inline-block rounded-sm px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider"
            style={{ background: 'rgba(201,146,42,0.15)', color: 'var(--gold-bright)' }}
          >
            census tract
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1 px-3 py-2">
        {rows.map((r) => (
          <Row key={r.label} label={r.label} value={r.value} />
        ))}
      </div>
    </div>
  );
}
