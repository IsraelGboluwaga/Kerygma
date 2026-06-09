import type { Config } from 'tailwindcss'

// Color tokens backed by CSS custom properties so they flip between dark and
// light mode by swapping :root vars — no per-class dark: variants needed.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Page background (black in dark, warm white in light)
        bg: 'var(--c-bg)',
        accent: {
          DEFAULT: '#df4e4e',
          hover: '#c93c3c',
          muted: 'var(--c-accent-dim-bg)',
          selected: 'var(--c-accent-selected-bg)',
        },
        surface: {
          DEFAULT: 'var(--c-surface)',
          raised: 'var(--c-surface-3)',
          sunken: 'var(--c-surface-2)',
        },
        line: { DEFAULT: 'var(--c-border)', strong: 'var(--c-border-2)' },
        ink: {
          DEFAULT: 'var(--c-text-2)',
          dim: 'var(--c-text-4)',
          faint: 'var(--c-text-6)',
          ghost: 'var(--c-text-7)',
          bright: 'var(--c-text)',
        },
        err: {
          bg: 'var(--c-err-bg)',
          text: 'var(--c-err-text)',
          border: 'var(--c-err-border)',
        },
        badge: {
          'queued-bg': 'var(--c-badge-q-bg)', 'queued-fg': 'var(--c-badge-q-text)',
          'running-bg': 'var(--c-badge-r-bg)', 'running-fg': 'var(--c-badge-r-text)',
          'done-bg': 'var(--c-badge-d-bg)', 'done-fg': 'var(--c-badge-d-text)',
          'failed-bg': 'var(--c-badge-f-bg)', 'failed-fg': 'var(--c-badge-f-text)',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'sans-serif'],
      },
      maxWidth: {
        bubble: '680px',
      },
    },
  },
  plugins: [],
} satisfies Config
