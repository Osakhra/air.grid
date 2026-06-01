/**
 * Site-level configuration for air.grid (a castor subdomain).
 * The Castor Nav/Footer import `siteConfig` and `navLinks` from here.
 */

export const siteConfig = {
  // Display name — Nav renders it as "> air.grid"
  name: 'air.grid',
  legalName: 'Andrew Castor',
  title: 'Live U.S. air-quality & emissions atlas',
  domain: 'air.andrewcastor.dev',

  email: 'JohnAndrewCastor@gmail.com',
  links: {
    github: 'https://github.com/osakhra',
    linkedin: 'https://linkedin.com/in/jandrewcastor',
  },

  meta: {
    description:
      'A live atlas of U.S. air quality, industrial emissions, and the schools and neighborhoods next to them — on one interactive map. Built on Next.js, Tailwind, and TypeScript.',
    keywords: [
      'air quality',
      'emissions',
      'environmental data',
      'data visualization',
      'AQI map',
      'andrew castor',
    ],
  },
};

/** Top nav links — these map to the app's routes. */
export const navLinks = [
  { label: 'Map', href: '/' },
  { label: 'Analysis', href: '/analysis' },
  { label: 'About', href: '/about' },
];
