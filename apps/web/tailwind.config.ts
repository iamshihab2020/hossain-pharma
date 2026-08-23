import type { Config } from 'tailwindcss';
import preset from '@nexmarket/config/tailwind/preset';

/**
 * Tailwind 3.4, pinned. The 32 salvaged shadcn primitives and the shared
 * globals.css are v3 format; Tailwind 4 is CSS-first (@theme blocks) and would
 * require converting both. That is a deliberate later task, not something to
 * absorb while also salvaging v3 assets.
 *
 * `content` and `plugins` are declared here rather than inherited from the
 * preset: globs are per-app, and a preset that requires a plugin forces that
 * dependency on every consumer.
 */
export default {
  presets: [preset],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
  ],
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
