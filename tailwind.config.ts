import type { Config } from 'tailwindcss';

/**
 * CastorUI Tailwind config.
 *
 * Color tokens are CSS vars — Tailwind maps to var(--token) so the light/dark
 * theme system works automatically. Raw hex values live in globals.css :root.
 *
 * RGB channel vars (space-separated, no commas) are defined in globals.css for
 * Tailwind opacity-modifier support: bg-bg-primary/80, text-accent-teal/50, etc.
 *
 * Do not change tokens here without updating:
 *   - app/globals.css  (the actual values)
 *   - data/tokens.ts   (TypeScript constants for non-Tailwind use)
 *   - docs/DESIGN_TOKENS.md
 */
const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── Backgrounds ──────────────────────────────────────────────────────
        'bg-primary':  'rgb(var(--bg-primary-rgb) / <alpha-value>)',
        'bg-secondary': 'rgb(var(--bg-secondary-rgb) / <alpha-value>)',
        'bg-tertiary':  'rgb(var(--bg-tertiary-rgb) / <alpha-value>)',
        bg: {
          primary:  'rgb(var(--bg-primary-rgb) / <alpha-value>)',
          secondary: 'rgb(var(--bg-secondary-rgb) / <alpha-value>)',
          tertiary:  'rgb(var(--bg-tertiary-rgb) / <alpha-value>)',
          terminal:  'var(--bg-terminal)',
        },

        // ── Text ─────────────────────────────────────────────────────────────
        ink: 'var(--text-primary)',        // flat alias used by budget/subdomains
        'ink-muted': 'var(--text-muted)',
        text: {
          primary:   'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary:  'var(--text-tertiary)',
          muted:     'var(--text-muted)',
        },

        // ── Borders ──────────────────────────────────────────────────────────
        'bg-border': 'var(--border-default)',
        border: {
          subtle:  'var(--border-subtle)',
          DEFAULT: 'var(--border-default)',
          accent:  'var(--border-accent)',
        },

        // ── Accents ───────────────────────────────────────────────────────────
        teal: 'rgb(var(--accent-teal-rgb) / <alpha-value>)',
        'bg-elevated': 'var(--bg-secondary)',
        accent: {
          teal:          'rgb(var(--accent-teal-rgb) / <alpha-value>)',
          'teal-dim':    'var(--accent-teal-dim)',
          'teal-glow':   'var(--accent-teal-glow)',
          purple:        'var(--accent-purple)',
          'purple-soft': 'var(--accent-purple-soft)',
          'purple-bright': 'rgb(var(--accent-purple-bright-rgb) / <alpha-value>)',
        },

        // ── Semantic tokens ──────────────────────────────────────────────────
        gold:        'var(--gold)',
        'gold-bright': 'var(--gold-bright)',
        danger:      'var(--danger)',
        warn:        'var(--warn)',
        ok:          'var(--ok)',

        // ── Status ────────────────────────────────────────────────────────────
        status: {
          'shipped-bg':     'var(--status-shipped-bg)',
          'shipped-border': 'var(--status-shipped-border)',
          'progress-bg':    'var(--status-progress-bg)',
          'progress-border': 'var(--status-progress-border)',
        },
      },
      fontFamily: {
        display: ['Sora', 'system-ui', 'sans-serif'],
        body: ['Outfit', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      animation: {
        'fade-in':    'fadeIn 0.6s ease-out forwards',
        'fade-up':    'fadeUp 0.6s ease-out forwards',
        'pulse-slow': 'pulseSlow 3s ease-in-out infinite',
        blink:        'blink 1.2s step-end infinite',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSlow: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.6' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
