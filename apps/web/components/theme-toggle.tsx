'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Theme = 'light' | 'dark' | 'system';

/**
 * Three states, not a two-way switch.
 *
 * "System" is the default and has to stay reachable: a visitor who tries dark
 * and changes their mind should be able to hand the decision back to their
 * phone rather than being stuck with whichever of the two they last tapped.
 */
export function ThemeToggle(): ReactNode {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('nm-theme');
      if (stored === 'light' || stored === 'dark') setTheme(stored);
    } catch {
      // Site data blocked. The control still works for this page view.
    }
  }, []);

  // Kept in sync with the OS while the choice is "system": a phone switching to
  // dark at sunset should carry the open tab with it.
  useEffect(() => {
    if (theme !== 'system') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => {
      document.documentElement.classList.toggle('dark', query.matches);
    };
    apply();
    query.addEventListener('change', apply);
    return () => {
      query.removeEventListener('change', apply);
    };
  }, [theme]);

  function choose(next: Theme): void {
    setTheme(next);
    try {
      if (next === 'system') localStorage.removeItem('nm-theme');
      else localStorage.setItem('nm-theme', next);
    } catch {
      // Ignored for the same reason as above.
    }
    const dark =
      next === 'dark' ||
      (next === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme">
          <Sun className="h-4 w-4 dark:hidden" />
          <Moon className="hidden h-4 w-4 dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => { choose('light'); }}>
          <Sun className="mr-2 h-4 w-4" /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { choose('dark'); }}>
          <Moon className="mr-2 h-4 w-4" /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { choose('system'); }}>
          <Monitor className="mr-2 h-4 w-4" /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
