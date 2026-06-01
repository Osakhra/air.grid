/**
 * AQI category helpers — shared between chart and table components.
 * Values match the EPA standard AQI color palette defined in globals.css.
 */

export interface AqiCategory {
  label: string;
  min: number;
  max: number;
  color: string; // CSS custom property reference
  hex: string;   // Fallback hex for recharts (which cannot read CSS vars)
}

export const AQI_CATEGORIES: AqiCategory[] = [
  { label: 'Good',                    min: 0,   max: 50,  color: 'var(--aqi-good)',          hex: '#46A758' },
  { label: 'Moderate',               min: 51,  max: 100, color: 'var(--aqi-moderate)',       hex: '#E6B547' },
  { label: 'Unhealthy for Sensitive', min: 101, max: 150, color: 'var(--aqi-sensitive)',      hex: '#F5A524' },
  { label: 'Unhealthy',              min: 151, max: 200, color: 'var(--aqi-unhealthy)',      hex: '#E5484D' },
  { label: 'Very Unhealthy',         min: 201, max: 300, color: 'var(--aqi-veryunhealthy)',  hex: '#9B6FD4' },
  { label: 'Hazardous',              min: 301, max: 999, color: 'var(--aqi-hazardous)',      hex: '#7E2230' },
];

export function getAqiCategory(aqi: number): AqiCategory {
  for (const cat of AQI_CATEGORIES) {
    if (aqi >= cat.min && aqi <= cat.max) return cat;
  }
  return AQI_CATEGORIES[AQI_CATEGORIES.length - 1];
}

export function aqiColor(aqi: number): string {
  return getAqiCategory(aqi).hex;
}

export function aqiLabel(aqi: number): string {
  return getAqiCategory(aqi).label;
}

/** Format ISO timestamp for display — shows relative age if > 1 hour stale */
export function formatObservedAt(isoStr: string): { display: string; isStale: boolean } {
  const observed = new Date(isoStr);
  const now = Date.now();
  const diffMs = now - observed.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  const isStale = diffHours > 2;

  const display = observed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return { display, isStale };
}

/** Format large numbers with locale commas */
export function fmtNum(n: number, decimals = 0): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format emissions value — abbreviate to K/M/B for readability */
export function fmtEmissions(val: number): string {
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toFixed(1);
}
