import type { Config } from 'tailwindcss'

// Design tokens lifted from the original hand-written CSS so the React UI keeps
// the same dark theme and red accent.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: '#df4e4e', hover: '#c93c3c', muted: '#5a2222' },
        surface: { DEFAULT: '#0d0d0d', raised: '#111', sunken: '#0a0a0a' },
        line: { DEFAULT: '#1f1f1f', strong: '#2a2a2a' },
        ink: { DEFAULT: '#e5e5e5', dim: '#888', faint: '#555', ghost: '#444' },
        badge: {
          'queued-bg': '#1a1500', 'queued-fg': '#c4a010',
          'running-bg': '#00101a', 'running-fg': '#3a9fd6',
          'done-bg': '#001a08', 'done-fg': '#3abf6e',
          'failed-bg': '#1c0e0e', 'failed-fg': '#ef8888',
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
