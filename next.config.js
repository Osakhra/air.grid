/** @type {import('next').NextConfig} */
// NOTE: unlike the CastorUI starter, air.grid does NOT use output:'export'.
// The hourly air-quality refresh runs as a serverless/cron function, which a
// static export cannot host. Deploy as a normal Next.js app on Vercel.
const nextConfig = {
  reactStrictMode: true,
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
// The cron schedule runs /api/refresh every hour on the hour (UTC).
// Vercel reads this from vercel.json; this comment is the authoritative note.
// See /vercel.json for the actual cron declaration.
