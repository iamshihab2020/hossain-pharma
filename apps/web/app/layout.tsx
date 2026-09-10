import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Anek_Bangla, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { ThemeScript } from '@/components/theme-script';
import './globals.css';

/**
 * IBM Plex Sans carries everything, chosen for its tabular figures and its
 * engineered rather than friendly tone: prices are the most-read element in
 * this product and money should look measured. See docs/DESIGN-DIRECTION.md.
 *
 * `next/font` self-hosts and subsets these at build time, so there is no
 * request to Google at runtime and no layout shift while a face loads. That
 * matters more here than usual - the audience is a mid-range Android on
 * metered 4G.
 */
const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

/**
 * The Bengali partner, at a matched x-height. A second SCRIPT, not a second
 * voice - display weight comes from size and tracking, never a third family.
 *
 * Subset to `bengali` alone: the Latin coverage would duplicate Plex for no
 * benefit, and Bengali faces are heavy enough that the duplication is a real
 * number on a metered connection rather than a rounding error.
 */
const bengali = Anek_Bangla({
  subsets: ['bengali'],
  weight: ['400', '600'],
  variable: '--font-bengali',
  display: 'swap',
});

/** Machine identifiers only: order numbers, SKUs, tracking codes. Never labels. */
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'NexMarket',
    template: '%s · NexMarket',
  },
  description: 'Compare every seller before you buy.',
};

export const viewport: Viewport = {
  // The theme colour follows the palette rather than the browser default, so
  // the address bar does not sit in a different world from the page.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#EFF1F0' },
    { media: '(prefers-color-scheme: dark)', color: '#0A100F' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${bengali.variable} ${mono.variable}`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="flex min-h-screen flex-col bg-background text-foreground antialiased">
        {/* Keyboard users reach the catalogue without tabbing the whole nav. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
