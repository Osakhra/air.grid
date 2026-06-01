'use client';

import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: 'teal' | 'warn' | 'danger' | 'gold' | 'purple';
  live?: boolean;
  timestamp?: string;
  isStale?: boolean;
}

const ACCENT_CLASSES: Record<string, string> = {
  teal:   'text-accent-teal',
  warn:   'text-warn',
  danger: 'text-danger',
  gold:   'text-gold',
  purple: 'text-accent-purple-bright',
};

export function StatCard({
  label,
  value,
  sub,
  accent = 'teal',
  live = false,
  timestamp,
  isStale = false,
}: StatCardProps) {
  const accentClass = ACCENT_CLASSES[accent] ?? ACCENT_CLASSES.teal;

  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-border-default bg-bg-secondary p-4"
      style={{ minWidth: 140 }}
    >
      {/* Live indicator row */}
      {live && (
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
            {isStale ? 'STALE' : 'LIVE'}
          </span>
        </div>
      )}

      {/* Value */}
      <div className={`font-display text-2xl font-semibold ${accentClass}`}>{value}</div>

      {/* Label */}
      <div className="font-body text-[12px] text-text-secondary">{label}</div>

      {/* Sub / timestamp */}
      {sub && (
        <div
          className="font-mono text-[10px]"
          style={{ color: isStale ? 'var(--warn)' : 'var(--text-muted)' }}
        >
          {sub}
        </div>
      )}
      {timestamp && !sub && (
        <div
          className="font-mono text-[10px]"
          style={{ color: isStale ? 'var(--warn)' : 'var(--text-muted)' }}
        >
          as of {timestamp}
        </div>
      )}
    </div>
  );
}
