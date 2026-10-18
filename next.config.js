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
