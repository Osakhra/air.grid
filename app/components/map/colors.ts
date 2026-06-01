/**
 * Color helpers for deck.gl layers.
 *
 * AQI colors are the EPA standard palette (non-negotiable per THEME.md).
 * Chrome/accent colors are read from CSS vars at runtime so dark/light toggle works.
 * All colors are RGBA tuples [r, g, b, a] as required by deck.gl.
 */

export type RGBA = [number, number, number, number];

// ── AQI palette (fixed EPA standard) ─────────────────────────────────────────

export function aqiToRgba(aqi: number | null, alpha = 220): RGBA {
  if (aqi === null || aqi < 0) return [126, 34, 48, alpha];
  if (aqi <= 50)  return [70,  167, 88,  alpha]; // good
  if (aqi <= 100) return [230, 181, 71,  alpha]; // moderate
  if (aqi <= 150) return [245, 165, 36,  alpha]; // sensitive
  if (aqi <= 200) return [229, 72,  77,  alpha]; // unhealthy
  if (aqi <= 300) return [155, 111, 212, alpha]; // very unhealthy
  return                 [126, 34,  48,  alpha]; // hazardous
}

export function aqiLabel(aqi: number | null): string {
  if (aqi === null || aqi < 0) return 'Unknown';
  if (aqi <= 50)  return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Sensitive Groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

// ── Facility pollutant palette (5 categories) ─────────────────────────────────

const POLLUTANT_COLORS: Record<string, RGBA> = {
  CO2:   [229, 72,  77,  200], // danger red — large GHG emitters
  'PM2.5': [245, 165, 36,  200], // warn orange
  NOx:   [230, 181, 71,  200], // gold
  SO2:   [155, 111, 212, 200], // purple
  other: [126, 145, 163, 200], // muted slate
};

export function facilityPollutantColor(pollutants: string[]): RGBA {
  if (!pollutants || pollutants.length === 0) return POLLUTANT_COLORS.other;
  const p = pollutants[0].toUpperCase();
  if (p.includes('CO2') || p.includes('CH4') || p.includes('N2O')) return POLLUTANT_COLORS.CO2;
  if (p.includes('PM2') || p.includes('PM 2'))                       return POLLUTANT_COLORS['PM2.5'];
  if (p.includes('NOX') || p.includes('NO2'))                        return POLLUTANT_COLORS.NOx;
  if (p.includes('SO2') || p.includes('SO4'))                        return POLLUTANT_COLORS.SO2;
  return POLLUTANT_COLORS.other;
}

export const POLLUTANT_LEGEND: Array<{ label: string; color: RGBA }> = [
  { label: 'CO2 / GHG',  color: POLLUTANT_COLORS.CO2 },
  { label: 'PM2.5',      color: POLLUTANT_COLORS['PM2.5'] },
  { label: 'NOx',        color: POLLUTANT_COLORS.NOx },
  { label: 'SO2',        color: POLLUTANT_COLORS.SO2 },
  { label: 'Other',      color: POLLUTANT_COLORS.other },
];

// ── School colors ─────────────────────────────────────────────────────────────

export const SCHOOL_K12_COLOR:    RGBA = [30,  158, 138, 180]; // teal
export const SCHOOL_COLLEGE_COLOR: RGBA = [155, 111, 212, 180]; // purple

// ── Facility point radius (log scale) ─────────────────────────────────────────

export function facilityRadius(emissionsValue: number): number {
  // log10 scale: 0 → 3px, 1e7+ → 20px
  if (!emissionsValue || emissionsValue <= 0) return 3;
  const logVal = Math.log10(emissionsValue);
  // logVal range roughly 0–8 for GHGRP facilities
  const normalized = Math.min(1, Math.max(0, (logVal - 1) / 7));
  return 3 + normalized * 17; // 3–20px
}

// ── Demographics color (pct_minority: 0=teal, 1=gold) ─────────────────────────

export function demoColor(pctMinority: number): RGBA {
  const t = Math.min(1, Math.max(0, pctMinority));
  // lerp teal → gold
  return [
    Math.round(30  + t * (201 - 30)),
    Math.round(158 + t * (146 - 158)),
    Math.round(138 + t * (42  - 138)),
    160,
  ];
}

// ── Wind arrow color ───────────────────────────────────────────────────────────

export const WIND_COLOR: RGBA = [30, 158, 138, 160]; // teal
