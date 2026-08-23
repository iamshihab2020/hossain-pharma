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

        // Semantic status colours. Used by order state, stock level, and
        // moderation badges across buyer, seller and admin surfaces.
        success: {
          DEFAULT: 'hsl(158 64% 52%)',
          light: 'hsl(152 69% 94%)',
          foreground: 'hsl(0 0% 100%)',
        },
        warning: {
          DEFAULT: 'hsl(38 92% 50%)',
          light: 'hsl(48 96% 89%)',
          foreground: 'hsl(0 0% 100%)',
        },
        danger: {
          DEFAULT: 'hsl(0 84% 60%)',
          light: 'hsl(0 93% 94%)',
          foreground: 'hsl(0 0% 100%)',
        },

        // Verified-seller badge (PRD section 9.2). Deliberately distinct from
        // `success` so "this seller is verified" never reads as "this action
        // succeeded".
        verified: {
          DEFAULT: 'hsl(168 76% 42%)',
          foreground: 'hsl(0 0% 100%)',
        },
      },
      borderRadius: {
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
