import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Manrope } from 'next/font/google';
import { Suspense } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthProvider } from '@/components/AuthProvider';
import './globals.css';

const body = Manrope({ variable: '--font-body', subsets: ['latin'] });
const display = Bricolage_Grotesque({ variable: '--font-display-face', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'SwarmAI',
  description: 'Your multi-agent personal assistant — email, calendar, research, travel, money, notes and reminders.',
  applicationName: 'SwarmAI',
  appleWebApp: { capable: true, title: 'SwarmAI', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f4ee' },
    { media: '(prefers-color-scheme: dark)', color: '#111214' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable} antialiased`}>
      <body>
        <Suspense fallback={null}>
          <AuthProvider>
            <AppShell>{children}</AppShell>
          </AuthProvider>
        </Suspense>
      </body>
    </html>
  );
}
