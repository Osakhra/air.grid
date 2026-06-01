'use client';

import dynamic from 'next/dynamic';

// DeckGL and maplibre-gl are browser-only. Dynamic import with ssr:false prevents
// server-side rendering of anything that touches window/navigator/WebGL.
const DeckMap = dynamic(() => import('./DeckMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <span className="live-dot h-2.5 w-2.5" />
        <p className="font-mono text-[12px] text-accent-teal tracking-widest uppercase">
          Initialising map…
        </p>
      </div>
    </div>
  ),
});

export default function MapLoader() {
  return <DeckMap />;
}
