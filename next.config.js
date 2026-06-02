/** @type {import('next').NextConfig} */
// NOTE: unlike the CastorUI starter, air.grid does NOT use output:'export'.
// The hourly air-quality refresh runs as a serverless/cron function, which a
// static export cannot host. Deploy as a normal Next.js app on Vercel.
const nextConfig = {
  reactStrictMode: true,
  // Belt-and-suspenders: exclude packages the Vercel builder must never ZIP into
  // a serverless function. Primary protection is .vercelignore + the useEffect
  // import pattern in MapLoader.tsx. This is the third layer.
  experimental: {
    outputFileTracingExcludes: {
      // Use the actual page paths that Vercel traces (not '*' which may be a
      // literal route match rather than a glob in some Next.js 14 patch versions).
      '/': [
        './node_modules/@next/swc-*/**',
        './node_modules/@arcgis/**',
        './node_modules/@loaders.gl/textures/**',
        './node_modules/maplibre-gl/dist/*.map',
      ],
      '/analysis': [
        './node_modules/@next/swc-*/**',
        './node_modules/@arcgis/**',
        './node_modules/@loaders.gl/textures/**',
      ],
      '/api/:path*': [
        './node_modules/@next/swc-*/**',
        './node_modules/@arcgis/**',
        './node_modules/@loaders.gl/textures/**',
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
