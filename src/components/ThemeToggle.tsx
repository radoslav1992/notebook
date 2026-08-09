import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './icons';

type Theme = 'light' | 'dark';

/** Mirrors the inline boot script in Base.astro, which sets the initial theme. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = document.documentElement.dataset.theme as Theme | undefined;
    setTheme(
      current ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    );
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('nblm-theme', next);
    } catch {
      /* private mode — the choice just will not persist */
    }
    setTheme(next);
  };

  return (
    <button
      className="btn-icon"
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label="Toggle colour theme"
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
