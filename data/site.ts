/**
 * Re-export from app/site.ts so that `@/data/site` resolves correctly.
 * Nav, Footer, and layout.tsx all import from this path per the castor-ui convention.
 */
export { siteConfig, navLinks } from '@/app/site';
