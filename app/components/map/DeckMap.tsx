'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Map, { NavigationControl } from 'react-map-gl/maplibre';
import DeckGL from '@deck.gl/react';
import type { PickingInfo } from '@deck.gl/core';
import { ScatterplotLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import 'maplibre-gl/dist/maplibre-gl.css';

import {
  FacilityFeature,
  SensorFeature,
  SchoolFeature,
  WindFeature,
  DemoFeature,
  TooltipState,
  LayerVisibility,
} from './types';
import {
  aqiToRgba,
  facilityPollutantColor,
  facilityRadius,
  SCHOOL_K12_COLOR,
  SCHOOL_COLLEGE_COLOR,
  demoColor,
  WIND_COLOR,
  RGBA,
} from './colors';
import LayerPanel from './LayerPanel';
import LiveHeader from './LiveHeader';
import MapTooltip from './MapTooltip';

// ── Constants ─────────────────────────────────────────────────────────────────

const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const SENSOR_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const INITIAL_VIEW_STATE = {
  latitude: 39.5,
  longitude: -98.35,
  zoom: 4,
  pitch: 0,
  bearing: 0,
};

// Mobile breakpoint
const MOBILE_BREAKPOINT = 768;

// ── Data fetch helpers ────────────────────────────────────────────────────────

async function fetchGeoJSON<T>(url: string): Promise<T[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[DeckMap] fetch ${url} → ${res.status}`);
  const fc = await res.json();
  return (fc.features ?? []) as T[];
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function DeckMap() {
  const [isMobile, setIsMobile] = useState(false);

  const [facilities, setFacilities]   = useState<FacilityFeature[]>([]);
  const [sensors, setSensors]         = useState<SensorFeature[]>([]);
  const [schools, setSchools]         = useState<SchoolFeature[]>([]);
  const [windData, setWindData]       = useState<WindFeature[]>([]);
  const [demographics, setDemographics] = useState<DemoFeature[]>([]);

  const [visibility, setVisibility] = useState<LayerVisibility>({
    facilities:   true,
    sensors:      true,
    schools:      false,
    wind:         false,
    demographics: false,
  });

  const [tooltip, setTooltip]       = useState<TooltipState | null>(null);
  const [observedAt, setObservedAt] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [loading, setLoading]       = useState(true);

  const sensorPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Detect mobile ────────────────────────────────────────────────────────────
  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      if (mobile) {
        setVisibility((v) => ({ ...v, wind: false }));
      }
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ── Initial data load ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const loadAll = async () => {
      setLoading(true);

      // Load sensors first (for the live header)
      try {
        const s = await fetchGeoJSON<SensorFeature>('/api/map/sensors');
        if (!cancelled) {
          setSensors(s);
          setLastRefresh(new Date());
          // Find most recent observed_at
          const latest = s
            .map((f) => f.properties.observed_at)
            .filter(Boolean)
            .sort()
            .at(-1) ?? null;
          setObservedAt(latest);
        }
      } catch (e) {
        console.error('[DeckMap] sensors load failed:', e);
      }

      // Load the rest in parallel
      const results = await Promise.allSettled([
        fetchGeoJSON<FacilityFeature>('/api/map/facilities'),
        fetchGeoJSON<SchoolFeature>('/api/map/schools'),
        fetchGeoJSON<WindFeature>('/api/map/wind'),
        fetchGeoJSON<DemoFeature>('/api/map/demographics'),
      ]);

      if (cancelled) return;

      const [facResult, schResult, windResult, demoResult] = results;
      if (facResult.status  === 'fulfilled') setFacilities(facResult.value);
      if (schResult.status  === 'fulfilled') setSchools(schResult.value);
      if (windResult.status === 'fulfilled') setWindData(windResult.value);
      if (demoResult.status === 'fulfilled') setDemographics(demoResult.value);

      setLoading(false);
    };

    loadAll();
    return () => { cancelled = true; };
  }, []);

  // ── Sensor polling ─────────────────────────────────────────────────────────────
  useEffect(() => {
    sensorPollRef.current = setInterval(async () => {
      try {
        const s = await fetchGeoJSON<SensorFeature>('/api/map/sensors');
        setSensors(s);
        setLastRefresh(new Date());
        const latest = s
          .map((f) => f.properties.observed_at)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null;
        setObservedAt(latest);
      } catch (e) {
        console.error('[DeckMap] sensor poll failed:', e);
      }
    }, SENSOR_POLL_INTERVAL_MS);

    return () => {
      if (sensorPollRef.current) clearInterval(sensorPollRef.current);
    };
  }, []);

  // ── Layer toggle ─────────────────────────────────────────────────────────────
  const toggleLayer = useCallback((layer: keyof LayerVisibility) => {
    setVisibility((v) => ({ ...v, [layer]: !v[layer] }));
  }, []);

  // ── Hover handler ─────────────────────────────────────────────────────────────
  const onHover = useCallback((info: PickingInfo) => {
    if (!info.picked || !info.object || !info.layer) {
      setTooltip(null);
      return;
    }

    const layerId: string = info.layer.id;
    const obj = info.object as FacilityFeature | SensorFeature | SchoolFeature | WindFeature | DemoFeature;

    if (!obj || typeof obj !== 'object' || !('properties' in obj)) {
      setTooltip(null);
      return;
    }

    const props = obj.properties as Record<string, unknown>;

    if (layerId === 'facilities-layer' && 'emissions_value' in props) {
      setTooltip({ x: info.x, y: info.y, object: { kind: 'facility', props: props as FacilityFeature['properties'] } });
    } else if (layerId === 'sensors-layer' && 'aqi' in props) {
      setTooltip({ x: info.x, y: info.y, object: { kind: 'sensor', props: props as SensorFeature['properties'] } });
    } else if (layerId === 'schools-layer' && 'level' in props) {
      setTooltip({ x: info.x, y: info.y, object: { kind: 'school', props: props as SchoolFeature['properties'] } });
    } else if (layerId === 'wind-layer' && 'dir_deg' in props) {
      setTooltip({ x: info.x, y: info.y, object: { kind: 'wind', props: props as WindFeature['properties'] } });
    } else if (layerId === 'demo-layer' && 'pct_minority' in props) {
      setTooltip({ x: info.x, y: info.y, object: { kind: 'demo', props: props as DemoFeature['properties'] } });
    } else {
      setTooltip(null);
    }
  }, []);

  // ── Build deck.gl layers ──────────────────────────────────────────────────────

  const deckLayers = [];

  // Demographics layer (rendered first — beneath everything)
  if (visibility.demographics && demographics.length > 0) {
    deckLayers.push(
      new ScatterplotLayer<DemoFeature>({
        id: 'demo-layer',
        data: demographics,
        getPosition: (d) => d.geometry.coordinates,
        getRadius: 5000,
        radiusUnits: 'meters',
        radiusMinPixels: isMobile ? 1 : 2,
        radiusMaxPixels: isMobile ? 6 : 10,
        getFillColor: (d) => demoColor(d.properties.pct_minority ?? 0),
        pickable: true,
        opacity: 0.6,
        updateTriggers: { getFillColor: [] },
      })
    );
  }

  // Facilities layer
  if (visibility.facilities && facilities.length > 0) {
    deckLayers.push(
      new ScatterplotLayer<FacilityFeature>({
        id: 'facilities-layer',
        data: facilities,
        getPosition: (d) => d.geometry.coordinates,
        getRadius: (d) => facilityRadius(d.properties.emissions_value ?? 0),
        radiusUnits: 'pixels',
        radiusMinPixels: 3,
        radiusMaxPixels: 20,
        getFillColor: (d) => facilityPollutantColor(d.properties.pollutants ?? []),
        pickable: true,
        opacity: 0.85,
        stroked: false,
        updateTriggers: { getFillColor: [], getRadius: [] },
      })
    );
  }

  // Sensors — HeatmapLayer (aggregated, avoids thousands of overlapping points)
  if (visibility.sensors && sensors.length > 0) {
    // Also draw individual ScatterplotLayer for hover/click picking
    deckLayers.push(
      new HeatmapLayer<SensorFeature>({
        id: 'sensors-heatmap',
        data: sensors,
        getPosition: (d) => d.geometry.coordinates,
        getWeight: (d) => {
          const aqi = d.properties.aqi ?? 50;
          return Math.max(1, aqi / 50);
        },
        aggregation: 'SUM',
        radiusPixels: isMobile ? 25 : 40,
        intensity: 0.8,
        threshold: 0.05,
        colorRange: [
          [70,  167, 88,  255],
          [230, 181, 71,  255],
          [245, 165, 36,  255],
          [229, 72,  77,  255],
          [155, 111, 212, 255],
          [126, 34,  48,  255],
        ] as RGBA[],
        opacity: 0.6,
        pickable: false,
      })
    );

    // Thin scatter for picking (invisible but pickable)
    deckLayers.push(
      new ScatterplotLayer<SensorFeature>({
        id: 'sensors-layer',
        data: sensors,
        getPosition: (d) => d.geometry.coordinates,
        getRadius: 8,
        radiusUnits: 'pixels',
        radiusMinPixels: 6,
        radiusMaxPixels: 12,
        getFillColor: (d) => aqiToRgba(d.properties.aqi, 200),
        pickable: true,
        opacity: 0.0, // invisible — heatmap provides the visual
        stroked: true,
        getLineColor: (d) => aqiToRgba(d.properties.aqi, 180),
        lineWidthMinPixels: 1,
        updateTriggers: { getFillColor: [] },
      })
    );
  }

  // Schools layer (only when active — many points)
  if (visibility.schools && schools.length > 0) {
    deckLayers.push(
      new ScatterplotLayer<SchoolFeature>({
        id: 'schools-layer',
        data: schools,
        getPosition: (d) => d.geometry.coordinates,
        getRadius: isMobile ? 3 : 4,
        radiusUnits: 'pixels',
        radiusMinPixels: 2,
        radiusMaxPixels: 8,
        getFillColor: (d) =>
          d.properties.level === 'k12' ? SCHOOL_K12_COLOR : SCHOOL_COLLEGE_COLOR,
        pickable: true,
        opacity: 0.7,
        stroked: false,
        updateTriggers: { getFillColor: [] },
      })
    );
  }

  // Wind layer (disabled on mobile)
  if (!isMobile && visibility.wind && windData.length > 0) {
    // Render wind stations as dots with direction lines via two ScatterplotLayers
    // Use ScatterplotLayer for station dots
    deckLayers.push(
      new ScatterplotLayer<WindFeature>({
        id: 'wind-layer',
        data: windData,
        getPosition: (d) => d.geometry.coordinates,
        getRadius: 4,
        radiusUnits: 'pixels',
        radiusMinPixels: 3,
        radiusMaxPixels: 6,
        getFillColor: WIND_COLOR,
        pickable: true,
        opacity: 0.8,
        stroked: true,
        getLineColor: [30, 158, 138, 255],
        lineWidthMinPixels: 1,
        updateTriggers: {},
      })
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="relative h-full w-full">
      {/* Loading overlay */}
      {loading && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center"
          style={{ background: 'rgba(8, 11, 18, 0.7)', backdropFilter: 'blur(4px)' }}
        >
          <div className="flex flex-col items-center gap-3">
            <span className="live-dot h-2.5 w-2.5" />
            <p className="font-mono text-[12px] text-accent-teal tracking-widest uppercase">
              Loading map data…
            </p>
          </div>
        </div>
      )}

      {/* Live header */}
      <LiveHeader
        observedAt={observedAt}
        sensorCount={sensors.length}
        lastRefresh={lastRefresh}
      />

      {/* Layer panel */}
      <LayerPanel
        visibility={visibility}
        onToggle={toggleLayer}
        isMobile={isMobile}
      />

      {/* Tooltip */}
      <MapTooltip tooltip={tooltip} />

      {/* Map + deck.gl */}
      <DeckGL
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        layers={deckLayers}
        onHover={onHover}
        getCursor={({ isDragging, isHovering }) =>
          isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'
        }
      >
        <Map
          mapStyle={BASEMAP_STYLE}
          attributionControl={false}
          reuseMaps
        >
          <NavigationControl position="bottom-right" />
        </Map>
      </DeckGL>
    </div>
  );
}
