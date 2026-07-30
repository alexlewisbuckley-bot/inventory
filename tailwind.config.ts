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
          overlay: 'rgb(var(--c-surface-overlay) / <alpha-value>)',
          inverse: 'rgb(var(--c-surface-inverse) / <alpha-value>)',
        },
        content: {
          primary: 'rgb(var(--c-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--c-text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--c-content-muted) / <alpha-value>)',
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
          // The V1 names now resolve to the V2 variables, which migrates all
          // forty-odd consumers in one move: `text-state-danger` renders the
          // V2 critical red everywhere it appears. The V1 CSS variables
          // (--c-success, --c-gold, --c-danger) become unreferenced and are
          // deleted from globals.css at the end of E7.
          success: 'rgb(var(--c-state-good) / <alpha-value>)',
          gold: 'rgb(var(--c-state-warning) / <alpha-value>)',
          danger: 'rgb(var(--c-state-critical) / <alpha-value>)',
          info: 'rgb(var(--c-navy-500) / <alpha-value>)',
          // V2: four reserved statuses. `success`/`gold`/`danger` above are
          // the V1 names and are removed in E7 once nothing references them.
          good: 'rgb(var(--c-state-good) / <alpha-value>)',
          warning: 'rgb(var(--c-state-warning) / <alpha-value>)',
          serious: 'rgb(var(--c-state-serious) / <alpha-value>)',
          critical: 'rgb(var(--c-state-critical) / <alpha-value>)',
        },
        // Charts address slots, never hues: `chart-3` is "the third series",
        // not "amber". That is what lets dark mode use different values for
        // the same slot without a component knowing.
        chart: {
          1: 'rgb(var(--c-chart-1) / <alpha-value>)',
          2: 'rgb(var(--c-chart-2) / <alpha-value>)',
          3: 'rgb(var(--c-chart-3) / <alpha-value>)',
          4: 'rgb(var(--c-chart-4) / <alpha-value>)',
          5: 'rgb(var(--c-chart-5) / <alpha-value>)',
          6: 'rgb(var(--c-chart-6) / <alpha-value>)',
          'seq-1': 'rgb(var(--c-chart-seq-1) / <alpha-value>)',
          'seq-2': 'rgb(var(--c-chart-seq-2) / <alpha-value>)',
          'seq-3': 'rgb(var(--c-chart-seq-3) / <alpha-value>)',
          'seq-4': 'rgb(var(--c-chart-seq-4) / <alpha-value>)',
          'seq-5': 'rgb(var(--c-chart-seq-5) / <alpha-value>)',
          'div-1': 'rgb(var(--c-chart-div-1) / <alpha-value>)',
          'div-2': 'rgb(var(--c-chart-div-2) / <alpha-value>)',
          'div-3': 'rgb(var(--c-chart-div-3) / <alpha-value>)',
          'div-4': 'rgb(var(--c-chart-div-4) / <alpha-value>)',
          'div-5': 'rgb(var(--c-chart-div-5) / <alpha-value>)',
        },
      },
      borderRadius: { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px', pill: '999px', full: '999px' },
      spacing: {
        1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px',
        8: '32px', 10: '40px', 12: '48px', 16: '64px', 20: '80px', 24: '96px', 30: '120px',
        // Density-aware vertical steps. `--density-y` is 1 comfortable, 0.75
        // compact, and is set on the surface rather than passed as a prop, so
        // a component nested three levels deep inherits it without knowing.
        // Only the vertical axis compresses: the eye tracks columns
        // horizontally and rows vertically, so squeezing both makes a table
        // harder to read rather than denser.
        'dy-1': 'calc(4px * var(--density-y, 1))',
        'dy-2': 'calc(8px * var(--density-y, 1))',
        'dy-3': 'calc(12px * var(--density-y, 1))',
        'dy-4': 'calc(16px * var(--density-y, 1))',
        'dy-5': 'calc(20px * var(--density-y, 1))',
        'dy-6': 'calc(24px * var(--density-y, 1))',
      },
      // The control scale. Named `control-*` rather than `sm`/`md`/`lg` so it
      // cannot collide with Tailwind's own size words while both systems are
      // in the tree; E7 is what makes these the only heights that exist.
      height: { 'control-sm': '32px', 'control-md': '40px', 'control-lg': '44px' },
      minHeight: { 'control-sm': '32px', 'control-md': '40px', 'control-lg': '44px' },
      minWidth: { 'control-sm': '32px', 'control-md': '40px', 'control-lg': '44px' },
      transitionDuration: {
        fast: '120ms',
        base: '200ms',
        slow: '280ms',
        // Nothing exceeds 400ms. A user waiting on the interface is a user
        // who has stopped working.
        deliberate: '400ms',
      },
      transitionTimingFunction: {
        // `standard` decelerates into place — things arriving feel instant and
        // settle. `emphasis` is for the two blocking surfaces. `exit` is the
        // only accelerating curve, because leaving should not linger.
        standard: 'cubic-bezier(.2, 0, 0, 1)',
        emphasis: 'cubic-bezier(.4, 0, .2, 1)',
        exit: 'cubic-bezier(.4, 0, 1, 1)',
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
        // Modal and command palette. Scale from .96 rather than from 0: a
        // surface that grows from nothing reads as an animation, one that
        // grows from nearly-full-size reads as arriving.
        'scale-in': {
          from: { transform: 'scale(.96)', opacity: '0' },
          to: { transform: 'scale(1)', opacity: '1' },
        },
        // A row that just changed. The only animation the user did not
        // directly cause, and it exists to answer "which one moved?".
        'row-settle': {
          from: { backgroundColor: 'rgb(var(--c-teal-100))' },
          to: { backgroundColor: 'transparent' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.32, 0.72, 0, 1)',
        'slide-up': 'slide-up 180ms ease-out',
        shimmer: 'shimmer 1.6s infinite',
        'scale-in': 'scale-in 200ms cubic-bezier(.2, 0, 0, 1)',
        'row-settle': 'row-settle 600ms ease-out',
      },
    },
  },
  plugins: [],
}
export default config
