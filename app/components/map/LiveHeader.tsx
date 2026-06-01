'use client';

import { useEffect, useState } from 'react';

interface Props {
  observedAt: string | null;
  sensorCount: number;
  lastRefresh: Date | null;
}

function formatTime(iso: string | null): string {
  if (!iso) return '--:--';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

function formatRefreshAge(d: Date | null): string {
  if (!d) return '';
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60)  return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export default function LiveHeader({ observedAt, sensorCount, lastRefresh }: Props) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);

  const refreshAge = lastRefresh ? formatRefreshAge(lastRefresh) : '';

  return (
    <div
      className="absolute left-1/2 top-3 z-30 -translate-x-1/2 flex items-center gap-3 rounded-full border border-border-default px-4 py-1.5 shadow-lg"
      style={{ background: 'rgba(8, 11, 18, 0.88)', backdropFilter: 'blur(12px)' }}
    >
      {/* Live dot + label */}
      <div className="flex items-center gap-1.5">
        <span className="live-dot" />
        <span className="font-mono text-[11px] font-semibold text-accent-teal tracking-wider">
          LIVE
        </span>
      </div>

      <span className="text-border-default">·</span>

      {/* Observed time */}
      <div className="flex items-center gap-1">
        <span className="font-mono text-[10px] text-text-muted">Updated</span>
        <span className="font-mono text-[11px] font-medium text-text-primary">
          {formatTime(observedAt)}
        </span>
      </div>

      <span className="text-border-default">·</span>

      {/* Sensor count */}
      <div className="flex items-center gap-1">
        <span className="font-mono text-[11px] font-medium text-text-primary">
          {sensorCount > 0 ? sensorCount.toLocaleString() : '--'}
        </span>
        <span className="font-mono text-[10px] text-text-muted">sensors</span>
      </div>

      {/* Refresh age — only when we have data */}
      {refreshAge && (
        <>
          <span className="text-border-default hidden sm:inline">·</span>
          <span className="hidden font-mono text-[10px] text-text-muted sm:inline">
            {refreshAge}
          </span>
        </>
      )}
    </div>
  );
}
