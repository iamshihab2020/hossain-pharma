import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
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
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			// Healthcare-specific colors
  			trust: {
  				DEFAULT: 'hsl(210 100% 50%)',
  				light: 'hsl(210 100% 60%)',
  				dark: 'hsl(210 100% 40%)',
  				foreground: 'hsl(0 0% 100%)'
  			},
  			health: {
  				DEFAULT: 'hsl(158 64% 52%)',
  				light: 'hsl(158 64% 62%)',
  				dark: 'hsl(158 64% 42%)',
  				foreground: 'hsl(0 0% 100%)'
  			},
  			success: {
  				DEFAULT: 'hsl(158 64% 52%)',
  				light: 'hsl(152 69% 94%)',
  				foreground: 'hsl(0 0% 100%)'
  			},
  			warning: {
  				DEFAULT: 'hsl(38 92% 50%)',
  				light: 'hsl(48 96% 89%)',
  				foreground: 'hsl(0 0% 100%)'
  			},
  			danger: {
  				DEFAULT: 'hsl(0 84% 60%)',
  				light: 'hsl(0 93% 94%)',
  				foreground: 'hsl(0 0% 100%)'
  			},
  			verified: {
  				DEFAULT: 'hsl(168 76% 42%)',
  				foreground: 'hsl(0 0% 100%)'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require('tailwindcss-animate')],
}
export default config
