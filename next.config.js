/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  env: {
    // Prod must hit the worker directly: the Pages /api proxy is unreliable.
    // Dev overrides nothing — the localhost rewrite in `rewrites()` handles it.
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL || 'https://solidmaps-api.fbirele.workers.dev',
    NEXT_PUBLIC_PMTILES_URL: process.env.NEXT_PUBLIC_PMTILES_URL || '',
    // On-device (WebAssembly) routing. Off unless explicitly enabled — see lib/routewasm.ts.
    // Point the tile/config URLs at your own R2 bucket to run without a third party.
    NEXT_PUBLIC_ROUTEWASM_ENABLED: process.env.NEXT_PUBLIC_ROUTEWASM_ENABLED || '',
    NEXT_PUBLIC_ROUTEWASM_TILE_URL: process.env.NEXT_PUBLIC_ROUTEWASM_TILE_URL || '',
    NEXT_PUBLIC_ROUTEWASM_CONFIG_URL: process.env.NEXT_PUBLIC_ROUTEWASM_CONFIG_URL || '',
    NEXT_PUBLIC_ROUTEWASM_LOCALES_URL: process.env.NEXT_PUBLIC_ROUTEWASM_LOCALES_URL || '',
    NEXT_PUBLIC_ROUTEWASM_DATASET_ID: process.env.NEXT_PUBLIC_ROUTEWASM_DATASET_ID || '',
    NEXT_PUBLIC_ROUTEWASM_MAX_KM: process.env.NEXT_PUBLIC_ROUTEWASM_MAX_KM || '',
  },
  async rewrites() {
    if (process.env.NODE_ENV === 'development') {
      return [
        {
          source: '/api/:path*',
          destination: 'http://localhost:8787/api/:path*',
        },
      ];
    }
    return [];
  },
};

module.exports = nextConfig;
