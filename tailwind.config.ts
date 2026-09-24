import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F3F6F8',
        ink: '#17212B',
        surface: '#FFFFFF',
        surface2: '#E8EEF2',
        cobalt: '#284BC7',
        teal: '#287C78',
        copper: '#C96B43',
        line: '#D3DCE3',
        muted: '#617180',
        quiet: '#8A99A5',
        danger: '#A94442',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'IBM Plex Sans', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-mono)', 'IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        display: ['2rem', { lineHeight: '2.25rem', letterSpacing: '-0.03em', fontWeight: '600' }],
        title: ['1.75rem', { lineHeight: '2.125rem', letterSpacing: '-0.025em', fontWeight: '600' }],
        heading: ['1.25rem', { lineHeight: '1.625rem', letterSpacing: '-0.015em', fontWeight: '600' }],
        body: ['0.9375rem', { lineHeight: '1.4375rem', fontWeight: '400' }],
        meta: ['0.75rem', { lineHeight: '1rem', fontWeight: '500' }],
        code: ['0.8125rem', { lineHeight: '1.25rem', fontWeight: '400' }],
      },
      boxShadow: {
        panel: '0 10px 30px rgba(23, 33, 43, 0.07)',
        focus: '0 0 0 3px rgba(40, 75, 199, 0.18)',
      },
      borderRadius: {
        panel: '10px',
        control: '7px',
      },
    },
  },
  plugins: [],
} satisfies Config;
