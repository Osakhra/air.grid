'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { siteConfig, navLinks } from '@/data/site';
import { MenuIcon, XIcon } from '@/components/icons/Icons';
import ThemeToggle from '@/components/ui/ThemeToggle';

export default function Nav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border-subtle bg-bg-primary/85 backdrop-blur-md">
      <nav className="section-container flex h-14 items-center justify-between">
        <Link
          href="/"
          className="font-display text-[14px] font-semibold tracking-wide text-text-primary transition-colors hover:text-accent-teal"
        >
          <span className="text-accent-teal">{'>'}</span> {siteConfig.name.toLowerCase().replace(/\s+/g, '.')}
        </Link>

        {/* Desktop nav */}
        <ul className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className={`font-body text-[13px] font-medium transition-colors duration-200 ${
                  isActive(link.href)
                    ? 'text-accent-teal'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {link.label}
              </Link>
            </li>
          ))}
          <li>
            <ThemeToggle />
          </li>
        </ul>

        {/* Mobile: theme toggle + hamburger */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <button
            aria-label="Toggle menu"
            className="text-text-secondary"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <XIcon /> : <MenuIcon />}
          </button>
        </div>
      </nav>

      {/* Mobile menu */}
      {open && (
        <div className="border-t border-border-subtle md:hidden">
          <ul className="section-container flex flex-col gap-1 py-3">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={`block rounded-md px-3 py-2.5 font-body text-[15px] font-medium transition-colors ${
                    isActive(link.href)
                      ? 'bg-bg-tertiary text-accent-teal'
                      : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary'
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}
