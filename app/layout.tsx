import type { Metadata } from 'next';
import { siteConfig } from '@/data/site';
import Nav from '@/components/layout/Nav';
import Footer from '@/components/layout/Footer';
import NetworkGrid from '@/components/effects/NetworkGrid';
import './globals.css';

// NOTE: Nav, Footer, and NetworkGrid are copied from your castor-ui repo.
// If you haven't copied them yet, comment these imports out to boot bare.

export const metadata: Metadata = {
  metadataBase: new URL(`https://${siteConfig.domain}`),
  title: {
    default: `${siteConfig.name} · ${siteConfig.title}`,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.meta.description,
  keywords: siteConfig.meta.keywords,
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: `https://${siteConfig.domain}`,
    siteName: siteConfig.name,
    title: `${siteConfig.name} · ${siteConfig.title}`,
    description: siteConfig.meta.description,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${siteConfig.name} · ${siteConfig.title}`,
    description: siteConfig.meta.description,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body className="flex min-h-screen flex-col bg-bg-primary text-text-primary">
        <NetworkGrid />
        <Nav />
        <main className="flex-1 pt-14">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
