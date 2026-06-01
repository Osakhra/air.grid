import { siteConfig } from '@/data/site';

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border-subtle">
      <div className="section-container flex flex-col items-center justify-between gap-2 py-4 sm:flex-row">
        <p className="font-mono text-[11px] text-text-tertiary">
          &copy; {year} {siteConfig.name} · {siteConfig.domain}
        </p>
        <p className="font-mono text-[11px] text-text-tertiary">
          Built with Next.js · Tailwind · TypeScript
        </p>
      </div>
    </footer>
  );
}
