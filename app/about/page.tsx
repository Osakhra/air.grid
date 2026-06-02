import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About',
  description:
    'air.grid — a one-day experiment in AI-assisted development, building a live U.S. air quality and emissions atlas in a single day.',
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="section-container py-16">

        {/* Header */}
        <div className="mb-12 border-b border-border-subtle pb-10">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-widest text-accent-teal">
            air.andrewcastor.dev
          </p>
          <h1 className="font-display text-4xl font-bold tracking-tight text-text-primary">
            About this project
          </h1>
        </div>

        {/* Body */}
        <div className="grid gap-12 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-8 font-body text-base leading-relaxed text-text-secondary">

            <p>
              <code className="rounded bg-bg-secondary px-1.5 py-0.5 font-mono text-sm text-accent-teal">
                air.grid
              </code>{' '}
              is a one-day challenge, started and finished on June 1, 2026. Built across three
              Claude Code sessions — each running until usage limits reset — the goal was simple:
              prove that a developer with the right AI tooling can go from an empty repo to a
              deployed, data-rich atlas in a single day.
            </p>

            <p>
              The project wasn&apos;t meant to be ambitious. It was meant to be fast. Schema design,
              data ingestion, geospatial proximity joins, interactive frontend, QA, and deployment
              were all orchestrated through Claude Code&apos;s multi-agent system. No shortcuts on
              the data: 268,980 EPA-reported facilities, 15,897 live air quality sensors, 108,336
              schools, real geospatial joins computed with scipy&apos;s cKDTree — not mocked, not
              estimated.
            </p>

            <p>
              The{' '}
              <strong className="font-semibold text-text-primary">Grid Analysis</strong> page
              surfaces what those joins reveal: which facilities emit the most, which regions carry
              the heaviest load, which schools sit closest to emitters, and which majority-minority
              Census tracts overlap with the highest-emitting sites. All of it is public record.
              This just puts it in one place.
            </p>

            <a
              href="https://andrewcastor.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-accent-teal px-4 py-2 font-mono text-[13px] text-accent-teal transition-colors hover:bg-accent-teal hover:text-bg-primary"
            >
              View my portfolio →
            </a>

          </div>

          {/* Data sources sidebar */}
          <aside>
            <h2 className="mb-4 font-mono text-[11px] uppercase tracking-widest text-text-muted">
              Data sources
            </h2>
            <ul className="space-y-3 font-mono text-[12px] text-text-secondary">
              {[
                { label: 'AirNow',      sub: 'EPA official AQI readings' },
                { label: 'PurpleAir',   sub: 'Community PM2.5, EPA-corrected' },
                { label: 'OpenAQ',      sub: 'Global open air quality aggregator' },
                { label: 'EPA GHGRP',   sub: 'Greenhouse gas reporting, 2022' },
                { label: 'EPA ECHO',    sub: 'Air permit database, 2024' },
                { label: 'NCES',        sub: 'K-12 school locations & enrollment' },
                { label: 'IPEDS',       sub: 'Post-secondary institution data' },
                { label: 'Census ACS',  sub: '5-Year estimates, 2022' },
              ].map(({ label, sub }) => (
                <li key={label} className="border-l-2 border-border-subtle pl-3">
                  <span className="text-text-primary">{label}</span>
                  <br />
                  <span className="text-text-muted">{sub}</span>
                </li>
              ))}
            </ul>
          </aside>
        </div>

      </div>
    </div>
  );
}
