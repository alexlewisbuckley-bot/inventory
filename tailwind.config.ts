import type { Config } from 'tailwindcss'

/**
 * Design tokens mirror the "Bluecroft Tokens" Figma variable collection.
 * Colours resolve through CSS custom properties so a single `.dark` class
 * on <html> re-themes the whole application without duplicated class names.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          900: 'rgb(var(--c-navy-900) / <alpha-value>)',
          700: 'rgb(var(--c-navy-700) / <alpha-value>)',
          500: 'rgb(var(--c-navy-500) / <alpha-value>)',
        },
        teal: {
          100: 'rgb(var(--c-teal-100) / <alpha-value>)',
          500: 'rgb(var(--c-teal-500) / <alpha-value>)',
          600: 'rgb(var(--c-teal-600) / <alpha-value>)',
        },
        surface: {
          page: 'rgb(var(--c-surface-page) / <alpha-value>)',
          subtle: 'rgb(var(--c-surface-subtle) / <alpha-value>)',
          raised: 'rgb(var(--c-surface-raised) / <alpha-value>)',
          inverse: 'rgb(var(--c-surface-inverse) / <alpha-value>)',
        },
        content: {
          primary: 'rgb(var(--c-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--c-text-secondary) / <alpha-value>)',
          inverse: 'rgb(var(--c-text-inverse) / <alpha-value>)',
          'inverse-muted': 'rgb(var(--c-text-inverse-muted) / <alpha-value>)',
          accent: 'rgb(var(--c-text-accent) / <alpha-value>)',
        },
        line: {
          subtle: 'rgb(var(--c-border-subtle) / <alpha-value>)',
          strong: 'rgb(var(--c-border-strong) / <alpha-value>)',
        },
        series: {
          1: 'rgb(var(--c-series-1) / <alpha-value>)',
          2: 'rgb(var(--c-series-2) / <alpha-value>)',
        },
        state: {
          success: 'rgb(var(--c-success) / <alpha-value>)',
          gold: 'rgb(var(--c-gold) / <alpha-value>)',
          danger: 'rgb(var(--c-danger) / <alpha-value>)',
          info: 'rgb(var(--c-navy-500) / <alpha-value>)',
        },
      },
      borderRadius: { sm: '8px', md: '12px', lg: '16px', xl: '24px', pill: '999px' },
      spacing: {
        1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px',
        8: '32px', 10: '40px', 12: '48px', 16: '64px', 20: '80px', 24: '96px', 30: '120px',
      },
      fontFamily: {
        // The webfont leads, but the fallback stack is a deliberate, complete
        // system stack — if the CDN is blocked the app still renders correctly.
        sans: [
          'var(--font-jakarta)', 'ui-sans-serif', 'system-ui', '-apple-system',
          'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif',
        ],
      },
      fontSize: {
        micro: ['11px', { lineHeight: '16px', letterSpacing: '0.04em' }],
        caption: ['12px', { lineHeight: '18px' }],
        small: ['13px', { lineHeight: '20px' }],
        body: ['14px', { lineHeight: '22px' }],
        'body-lg': ['16px', { lineHeight: '26px' }],
        h3: ['20px', { lineHeight: '28px', letterSpacing: '-0.01em' }],
        h2: ['26px', { lineHeight: '34px', letterSpacing: '-0.015em' }],
        h1: ['32px', { lineHeight: '40px', letterSpacing: '-0.02em' }],
        display: ['40px', { lineHeight: '48px', letterSpacing: '-0.025em' }],
      },
      boxShadow: {
        card: '0 2px 8px rgb(var(--c-shadow) / 0.06)',
        raised: '0 4px 16px rgb(var(--c-shadow) / 0.10)',
        overlay: '0 20px 60px -10px rgb(var(--c-shadow) / 0.30)',
        drawer: '-12px 0 40px -8px rgb(var(--c-shadow) / 0.25)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'slide-up': { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.32, 0.72, 0, 1)',
        'slide-up': 'slide-up 180ms ease-out',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
}
export default config
