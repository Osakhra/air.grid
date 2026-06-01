/**
 * app/page.tsx — Home / interactive map
 *
 * Full-viewport dark-basemap map built with MapLibre GL + deck.gl.
 * The map sits beneath the fixed Nav (h-14 / pt-14) and above the Footer.
 * NetworkGrid is always rendered in layout.tsx as the ambient background;
 * the map covers it once loaded.
 *
 * Layers (each independently toggleable):
 *   - Facilities (ScatterplotLayer, sized by emissions, colored by pollutant)
 *   - Air Quality sensors (HeatmapLayer + ScatterplotLayer for picking)
 *   - Schools (ScatterplotLayer, teal = K-12, purple = college)
 *   - Wind arrows (ScatterplotLayer, disabled on mobile)
 *   - Demographics (ScatterplotLayer, teal→gold by pct_minority)
 */

import MapLoader from '@/components/map/MapLoader';

// This page does not export metadata — the root layout handles it.
// The page itself is a server component; MapLoader is 'use client' + dynamic.

export default function Home() {
  return (
    // The map fills the viewport height minus the Nav (h-14 = 3.5rem).
    // overflow-hidden prevents any inner scroll from the deck.gl canvas.
    // The Footer remains accessible by scrolling past the map — it's "edge chrome".
    <div
      className="relative w-full overflow-hidden"
      style={{ height: 'calc(100vh - 3.5rem)' }}
    >
      <MapLoader />
    </div>
  );
}
