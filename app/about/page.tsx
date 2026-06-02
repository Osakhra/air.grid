import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About',
  description:
    'About air.grid — a live U.S. air quality and industrial emissions atlas built on open government data.',
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="section-container py-16">

        {/* Header */}
        <div className="mb-12 border-b border-border-subtle pb-10">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-widest text-accent-teal">
            air.grid
          </p>
          <h1 className="font-display text-4xl font-bold tracking-tight text-text-primary">
            About this project
          </h1>
        </div>

        {/* Body */}
        <div className="grid gap-12 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-8 font-body text-base leading-relaxed text-text-secondary">

            <p>
              <strong className="font-semibold text-text-primary">air.grid</strong> is a live atlas
              of U.S. air quality, industrial emissions, and the schools and neighborhoods that sit
              next to them. Every layer on the map is drawn from open government data — no
              estimates, no interpolation. If a facility is there, it was reported to the EPA. If a
              sensor reading is there, it came from an official or community monitoring network
              within the last refresh cycle.
            </p>

            <p>
              The project joins four data streams that are rarely seen together: real-time air
              quality from AirNow, PurpleAir, and OpenAQ; industrial emissions reported under the
              EPA Greenhouse Gas Reporting Program (GHGRP) and the EPA ECHO permit database;
              school locations and enrollment from NCES and IPEDS; and Census tract demographics
              from the American Community Survey. A geospatial proximity join links every school to
              its nearest emitters and sensors, and flags campuses that are downwind of a reporting
              facility within 10 km.
            </p>

            <p>
              The <strong className="font-semibold text-text-primary">Grid Analysis</strong> page
              summarises what that join reveals: which facilities emit the most, which regions carry
              the heaviest load, which schools are most exposed, and which majority-minority Census
              tracts overlap with the highest-emitting sites. None of this is new information — it
              is all public record. air.grid just puts it on one map.
            </p>

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
