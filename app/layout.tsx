import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';

export const metadata: Metadata = {
  title: 'solidmaps — drive smarter, park legally',
  description:
    'Unified consumer navigation with Pro truck routing, parking compliance and ULEZ-aware routes.',
  manifest: '/manifest.json',
  icons: { icon: '/icon.svg' },
  appleWebApp: { capable: true, title: 'solidmaps', statusBarStyle: 'black-translucent' },
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
