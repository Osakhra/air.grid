# Theme — inheriting CastorUI

air.grid is a `*.castor`-family subdomain. It must read as the same author's work even though
the interior (a full-bleed dark map) looks different from the portfolio pages. The rule from
the Castor system: **subdomains inherit the base theme and override accent vars only.**

## What carries over (the "edges")

These chrome elements are lifted directly from `castor-ui/components` so the site feels like
yours the moment it loads, before anyone looks at the map:

1. **Nav** — fixed top bar, `border-b border-border-subtle`, `bg-bg-primary/85 backdrop-blur-md`,
   terminal-prompt logo (`> air.grid` with a teal `>`), teal active link, ThemeToggle.
2. **Footer** — `border-t border-border-subtle`, JetBrains Mono 11px, "© {year} … · domain"
   and a "Built with Next.js · Tailwind · TypeScript" line.
3. **NetworkGrid** — the animated teal/purple node-and-packet canvas. Use it as the ambient
   background behind the loading state and any empty/hero panels. It is visually native to a
   sensor/grid map, so it bridges the portfolio aesthetic and the data UI.
4. **StatusPill / Card / Tag** chrome on the side panels and analysis cards.
5. **Type:** Sora (display/headings), Outfit (body), JetBrains Mono (numbers, labels, the live
   clock). Live readouts use a blinking `.live-dot`.
6. **Tokens:** navy `--bg-*`, teal/purple accents, `color-mix()` for tints. No hardcoded hex.

## What does NOT get themed

- **The AQI data scale.** Map points, the heatmap, the legend, and chart series use the
  standard EPA AQI palette in `globals.css` (`--aqi-*`), green→maroon. People recognize it;
  recoloring it to brand teal would make the data harder to read. Chrome is teal; data is AQI.
- **The basemap.** Keep a dark CARTO/MapLibre style that matches `--bg-primary`, but the
  cartography itself is not a brand surface.

## Implementation notes

- Copy `castor-ui/app/globals.css` token philosophy (done — see `app/globals.css` here) and
  reuse the four-files-in-sync rule (`globals.css` + `tailwind.config.ts` + `data/tokens.ts` +
  this doc) if you add tokens.
- For the canvas map, read theme colors at runtime via
  `getComputedStyle(document.documentElement)` so light/dark mode switches the chrome without
  recoloring the AQI data layer.
- Net effect: at the edges it's unmistakably your site; in the center it's a serious data tool.
