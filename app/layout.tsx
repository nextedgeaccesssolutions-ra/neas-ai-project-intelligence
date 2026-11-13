import type { Metadata, Viewport } from 'next';
import './globals.css';
import { StoreProvider } from '@/lib/store';
import Shell from '@/components/Shell';

export const metadata: Metadata = {
  title: 'NEAS Intelligence · Project Control',
  description: 'NextEdge Access Solutions project control: schedule, progress, BOQ, quotations, field reports and site evidence.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = { themeColor: '#071D29', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StoreProvider>
          <Shell>{children}</Shell>
        </StoreProvider>
      </body>
    </html>
  );
}
