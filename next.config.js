/** @type {import('next').NextConfig} */
// NOTE: unlike the CastorUI starter, air.grid does NOT use output:'export'.
// The hourly air-quality refresh runs as a serverless/cron function, which a
// static export cannot host. Deploy as a normal Next.js app on Vercel.
const nextConfig = {
  reactStrictMode: true,
  // Exclude large build-time and client-only packages from server function traces.
  // @next/swc-* platform binaries (~130 MB each) are build tools, not runtime deps.
  // @arcgis/core and @loaders.gl are transitive deps of deck.gl used only client-side.
  experimental: {
    outputFileTracingExcludes: {
      '*': [
        'node_modules/@next/swc-*/**/*',
        'node_modules/@arcgis/**/*',
        'node_modules/@loaders.gl/**/*',
        'node_modules/maplibre-gl/dist/*.map',
      ],
    },
  },
  transpilePackages: [
    'deck.gl',
    '@deck.gl/core',
    '@deck.gl/layers',
    '@deck.gl/react',
    '@deck.gl/aggregation-layers',
    '@deck.gl/mesh-layers',
    '@deck.gl/geo-layers',
    '@deck.gl/extensions',
    'maplibre-gl',
    'react-map-gl',
  ],
};

module.exports = nextConfig;

// Vercel cron configuration.
// The cron schedule runs /api/refresh once daily at 08:00 UTC (Vercel Hobby plan limit).
// Vercel reads this from vercel.json; this comment is the authoritative note.
// See /vercel.json for the actual cron declaration.
