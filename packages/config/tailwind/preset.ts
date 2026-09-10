import type { Config } from 'tailwindcss';

/**
 * Shared Tailwind theme, salvaged from the archived Next.js rewrite
 * (PRD section 12.1). Consumers declare their own `content` globs and their own
 * `plugins`; inheriting either from a preset scans the wrong directories or
 * forces a dependency on every consumer.
 *
 * Colours resolve through `hsl(var(--token))` and pair with
 * `@nexmarket/config/tailwind/globals.css`. Both files travel together or neither
 * works: a token here with no matching CSS variable renders as a broken colour
 * at runtime and is invisible to type-check.
 *
 * The palette itself is documented in `docs/DESIGN-DIRECTION.md`. The rule that
 * matters when adding to this file: COLOUR IS INFORMATION. There is no
 * decorative accent in this system, so a new colour needs a meaning, not a mood.
 */
// Annotated rather than `satisfies`. Tailwind types darkMode as
// Partial<DarkModeConfig>, whose tuple members only match when the array
// literal is CONTEXTUALLY typed; `satisfies` infers string[] first and fails.
// Partial<Omit<...>> keeps `content` excluded while leaving the rest optional.
const preset: Partial<Omit<Config, 'content'>> = {
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // ---- marketplace tokens -------------------------------------------
        //
        // These resolve through CSS variables like everything above, so they
        // follow the theme. The versions before this were fixed HSL literals
        // and glared in dark mode: a status colour that works on only one
        // ground is a status colour that lies half the time.

        /** The buy-box winner's row, and nothing else. */
        wash: 'hsl(var(--wash))',
        /** Below the ground: table headers, inset panels. */
        sunk: 'hsl(var(--sunk))',
        /** A rule that has to carry weight, such as a table header. */
        'line-strong': 'hsl(var(--line-strong))',

        /**
         * The only warm colour in the system, and it never means "sale".
         * Low stock, a price that moved, a payment not yet collected.
         */
        warn: {
          DEFAULT: 'hsl(var(--warn))',
          wash: 'hsl(var(--warn-wash))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          wash: 'hsl(var(--success-wash))',
        },

        /**
         * Verified-seller badge (PRD section 9.2). Deliberately the same value
         * as `primary`: on this storefront "we stand behind this" and "this is
         * the action to take" are the same signal, and splitting them into two
         * greens would say there is a difference the product does not have.
         */
        verified: 'hsl(var(--verified))',
      },
      fontFamily: {
        // Set by next/font in the root layout. Naming them here means the
        // font-sans utility and the body rule cannot drift apart.
        sans: ['var(--font-sans)', 'var(--font-bengali)', 'system-ui', 'sans-serif'],
        bengali: ['var(--font-bengali)', 'var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        // Radius by role. `tile` is for product imagery, `lg` for controls, and
        // table rows take none - one radius on everything flattens the
        // hierarchy it should be encoding.
        tile: 'var(--radius-tile)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
};

export default preset;
