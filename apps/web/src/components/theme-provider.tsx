'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import type { AppTheme } from '@/theme/config';

interface ThemeContextValue {
  /** The stored preference ('light' | 'dark' | 'system'). */
  theme: AppTheme;
  /** Apply a preference to the document immediately (the PUT persists it). */
  setTheme: (theme: AppTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isDark(theme: AppTheme): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(theme: AppTheme): void {
  document.documentElement.classList.toggle('dark', isDark(theme));
}

/**
 * Keeps the `dark` class on <html> in sync after first paint (ticket 7.3).
 * The class is owned by this provider (and the layout's bootstrap script),
 * never by the React tree, so hydration cannot strip it. Re-applies when the
 * server re-renders with a new stored preference (preferences PUT +
 * router.refresh()) and tracks live OS changes while the preference is
 * 'system'.
 */
export function ThemeProvider({
  theme,
  children,
}: {
  theme: AppTheme;
  children: ReactNode;
}): React.ReactElement {
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      applyTheme('system');
    };
    mql.addEventListener('change', onChange);
    return () => {
      mql.removeEventListener('change', onChange);
    };
  }, [theme]);

  const setTheme = useCallback((next: AppTheme): void => {
    applyTheme(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
