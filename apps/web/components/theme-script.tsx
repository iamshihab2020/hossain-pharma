import type { ReactNode } from 'react';

/**
 * Applies the stored theme BEFORE first paint.
 *
 * Tailwind's dark mode here is class-based (`darkMode: ['class']`), so the
 * `.dark` class has to be on `<html>` by the time the browser paints. Doing it
 * in an effect means every dark-mode visitor gets a white flash on every
 * navigation, which is worst on exactly the cheap devices this storefront is
 * built for.
 *
 * Inline and synchronous for that reason - a deferred or external script is too
 * late by definition. It is small enough to read in full, which is the other
 * half of why `dangerouslySetInnerHTML` is acceptable here: the string is a
 * literal in this file and no value from a request reaches it.
 *
 * Three states, not two: an explicit choice wins, and "system" means follow
 * `prefers-color-scheme` and keep following it if the OS changes.
 */
const SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('nm-theme');
    var dark = stored === 'dark' ||
      (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {
    // Private mode, or site data blocked. The light palette is the default and
    // the page must still render, so this is deliberately swallowed.
  }
})();
`;

export function ThemeScript(): ReactNode {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
