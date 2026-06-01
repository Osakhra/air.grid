'use client';

import { LayerVisibility } from './types';
import { POLLUTANT_LEGEND, aqiToRgba } from './colors';

interface Props {
  visibility: LayerVisibility;
  onToggle: (layer: keyof LayerVisibility) => void;
  isMobile: boolean;
}

function rgbaToCSS([r, g, b, a]: [number, number, number, number]): string {
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

const AQI_LEGEND = [
  { label: 'Good',           color: rgbaToCSS(aqiToRgba(25)) },
  { label: 'Moderate',       color: rgbaToCSS(aqiToRgba(75)) },
  { label: 'Sensitive',      color: rgbaToCSS(aqiToRgba(125)) },
  { label: 'Unhealthy',      color: rgbaToCSS(aqiToRgba(175)) },
  { label: 'Very Unhealthy', color: rgbaToCSS(aqiToRgba(250)) },
  { label: 'Hazardous',      color: rgbaToCSS(aqiToRgba(350)) },
];

interface LayerButtonProps {
  active: boolean;
  label: string;
  dotColor?: string;
  onClick: () => void;
  disabled?: boolean;
}

function LayerButton({ active, label, dotColor, onClick, disabled }: LayerButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors ${
        active
          ? 'bg-bg-tertiary text-text-primary'
          : 'text-text-muted hover:bg-bg-secondary hover:text-text-secondary'
      } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full transition-opacity"
        style={{
          background: dotColor ?? 'var(--accent-teal)',
          opacity: active ? 1 : 0.3,
          boxShadow: active && dotColor ? `0 0 6px ${dotColor}` : undefined,
        }}
      />
      <span className="font-mono text-[11px] font-medium">{label}</span>
      <span className="ml-auto font-mono text-[9px] text-text-muted">
        {active ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}

export default function LayerPanel({ visibility, onToggle, isMobile }: Props) {
  return (
    <div
      className="absolute bottom-8 left-3 z-30 w-[175px] rounded-xl border border-border-default shadow-2xl"
      style={{ background: 'rgba(8, 11, 18, 0.92)', backdropFilter: 'blur(12px)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-text-muted">
          Layers
        </span>
      </div>

      {/* Toggles */}
      <div className="flex flex-col gap-0.5 px-1.5 py-1.5">
        <LayerButton
          active={visibility.facilities}
          label="Facilities"
          dotColor="rgba(229, 72, 77, 0.9)"
          onClick={() => onToggle('facilities')}
        />
        <LayerButton
          active={visibility.sensors}
          label="Air Quality"
          dotColor="rgba(70, 167, 88, 0.9)"
          onClick={() => onToggle('sensors')}
        />
        <LayerButton
          active={visibility.schools}
          label="Schools"
          dotColor="rgba(30, 158, 138, 0.9)"
          onClick={() => onToggle('schools')}
        />
        <LayerButton
          active={visibility.wind}
          label="Wind"
          dotColor="rgba(30, 158, 138, 0.6)"
          onClick={() => onToggle('wind')}
          disabled={isMobile}
        />
        <LayerButton
          active={visibility.demographics}
          label="Demographics"
          dotColor="rgba(201, 146, 42, 0.9)"
          onClick={() => onToggle('demographics')}
        />
      </div>

      {/* Mini legend — shown when sensors layer is active */}
      {visibility.sensors && (
        <div className="border-t border-border-subtle px-3 py-2">
          <p className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-text-muted">
            AQI
          </p>
          <div className="flex flex-col gap-1">
            {AQI_LEGEND.map((item) => (
              <div key={item.label} className="flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: item.color }}
                />
                <span className="font-mono text-[9px] text-text-muted">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Facility pollutant legend — shown when facilities layer is active */}
      {visibility.facilities && (
        <div className="border-t border-border-subtle px-3 py-2">
          <p className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-text-muted">
            Pollutant
          </p>
          <div className="flex flex-col gap-1">
            {POLLUTANT_LEGEND.map((item) => (
              <div key={item.label} className="flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: `rgba(${item.color[0]}, ${item.color[1]}, ${item.color[2]}, 0.9)` }}
                />
                <span className="font-mono text-[9px] text-text-muted">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isMobile && (
        <div className="border-t border-border-subtle px-3 py-1.5">
          <p className="font-mono text-[9px] text-text-muted">Wind disabled on mobile</p>
        </div>
      )}
    </div>
  );
}
