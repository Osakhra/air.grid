/**
 * Canonical design tokens as TypeScript constants.
 *
 * Use these when working outside Tailwind (canvas drawing, inline styles,
 * SVG gradients, etc). When updating values here, also update:
 *   - app/globals.css   (CSS custom properties — the source of truth)
 *   - tailwind.config.ts
 *   - docs/DESIGN_TOKENS.md
 *
 * All four files must stay in sync.
 *
 * NOTE: These are the dark-mode (default) values. Light mode overrides are
 * defined in globals.css under [data-theme="light"]. For theme-reactive canvas
 * components, read colors via getComputedStyle(document.documentElement) at
 * runtime instead of importing from here.
 */

export const tokens = {
  bg: {
    primary:  '#080B12',
    secondary: '#0D1117',
    tertiary:  '#131A24',
    terminal:  '#0A0E18',
  },
  accent: {
    teal:         '#1E9E8A',
    tealDim:      '#17796A',
    tealGlow:     'rgba(30, 158, 138, 0.4)',
    purple:       '#5B2D8E',
    purpleSoft:   '#B89CE0',
    purpleBright: '#9B6FD4',
  },
  text: {
    primary:   '#D5DDE0',
    secondary: '#B5BEC8',
    tertiary:  '#A8B2BF',
    muted:     '#7E8898',
  },
  border: {
    subtle:  '#1E2737',
    default: '#2A3444',
    accent:  'rgba(30, 158, 138, 0.4)',
  },
  /** Semantic tokens — status, finance, feedback */
  semantic: {
    gold:       '#C9922A',
    goldBright: '#E6B547',
    danger:     '#E5484D',
    warn:       '#F5A524',
    ok:         '#46A758',
  },
  status: {
    shippedBg:      'rgba(30, 158, 138, 0.12)',
    shippedBorder:  'rgba(30, 158, 138, 0.3)',
    progressBg:     'rgba(91, 45, 142, 0.15)',
    progressBorder: 'rgba(91, 45, 142, 0.4)',
  },
  font: {
    display: 'Sora, system-ui, sans-serif',
    body:    'Outfit, system-ui, sans-serif',
    mono:    '"JetBrains Mono", monospace',
  },
} as const;

export type Tokens = typeof tokens;
