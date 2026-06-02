'use client';

import { useEffect, useState, type ComponentType } from 'react';

// Loading state shown until the browser loads DeckMap.
// Kept outside the component so its reference is stable across renders.
function LoadingUI() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <span className="live-dot h-2.5 w-2.5" />
        <p className="font-mono text-[12px] text-accent-teal tracking-widest uppercase">
          Initialising map…
        </p>
      </div>
    </div>
  );
}

// NOTE: we intentionally do NOT use next/dynamic here.
//
// next/dynamic generates a `loadableGenerated.modules` entry in the server-side
// compiled bundle. Vercel's builder (@vercel/next) follows that entry to trace
// DeckMap.tsx's dependencies — deck.gl → @loaders.gl → @arcgis/core (~200 MB
// of packages) — into the serverless function ZIP, exceeding the 250 MB limit.
//
// A plain import() inside useEffect never appears in the server bundle's
// loadableGenerated manifest, so the tracer never reaches deck.gl or maplibre-gl.
// The import is still code-split by webpack into a client-only chunk, so lazy
// loading and bundle splitting still work correctly in the browser.
export default function MapLoader() {
  const [DeckMap, setDeckMap] = useState<ComponentType | null>(null);

  useEffect(() => {
    import('./DeckMap').then((mod) => {
      setDeckMap(() => mod.default);
    });
  }, []);

  if (!DeckMap) return <LoadingUI />;
  return <DeckMap />;
}
