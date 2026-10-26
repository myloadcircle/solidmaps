import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';

export const metadata: Metadata = {
  metadataBase: new URL('https://solidmap.app'),
  title: 'SolidMaps — Drive smarter. Park legally.',
  description:
    'Free turn-by-turn navigation with voice guidance, automatic rerouting and live parking intelligence. Truck-aware route warnings for professional drivers.',
  manifest: '/manifest.json',
  icons: { icon: '/icon.svg', apple: '/icon-192.png' },
  appleWebApp: { capable: true, title: 'SolidMaps', statusBarStyle: 'black-translucent' },
  openGraph: {
    title: 'SolidMaps — Drive smarter. Park legally.',
    description: 'Turn-by-turn navigation, voice guidance and live parking intelligence.',
    url: 'https://solidmap.app',
    siteName: 'SolidMaps',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
