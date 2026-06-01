'use client';

import { useEffect, useState } from 'react';

/**
 * ThemeToggle
 *
 * Generic sun/moon toggle. Toggles data-theme on <html> between
 * "dark" (default) and "light". Persists selection in a cookie named
 * "theme" so it survives page reloads without a flash.
 *
 * Drop into any AppShell or Nav — no props required.
 *
 * Styling: uses btn-secondary from globals.css. Override as needed.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Read initial theme from the html element (set by FOUC-prevention script)
  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    if (current === 'light') setTheme('light');
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    // Update meta theme-color for browser chrome
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', next === 'dark' ? '#080B12' : '#FFFFFF');
    }
    // Persist in cookie (1-year expiry)
    document.cookie = `theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
  };

  return (
    <button
      onClick={toggle}
      className="btn-secondary flex h-8 w-8 items-center justify-center rounded-md p-0"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M7.5 0v1.5M7.5 13.5V15M0 7.5h1.5M13.5 7.5H15M2.197 2.197l1.06 1.06M11.743 11.743l1.06 1.06M2.197 12.803l1.06-1.06M11.743 3.257l1.06-1.06M10 7.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M12.5 9A5.5 5.5 0 0 1 5 1.5a5.5 5.5 0 1 0 7.5 7.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
