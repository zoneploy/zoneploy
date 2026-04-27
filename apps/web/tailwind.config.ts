import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ─── Design System (CSS variables) ────────────────────────────────────
        background: 'hsl(var(--background) / <alpha-value>)',
        'background-paper': 'hsl(var(--background-paper) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          light:   'hsl(var(--primary-light) / <alpha-value>)',
          dark:    'hsl(var(--primary-dark) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          light:   'hsl(var(--secondary-light) / <alpha-value>)',
          dark:    'hsl(var(--secondary-dark) / <alpha-value>)',
        },
        'text-primary':   'hsl(var(--text-primary)   / <alpha-value>)',
        'text-secondary': 'hsl(var(--text-secondary) / <alpha-value>)',
        'text-disabled':  'hsl(var(--text-disabled)  / <alpha-value>)',
        'text-contrast':  'hsl(var(--text-contrast)  / <alpha-value>)',
        grey: {
          20:  'hsl(var(--grey-20)  / <alpha-value>)',
          25:  'hsl(var(--grey-25)  / <alpha-value>)',
          50:  'hsl(var(--grey-50)  / <alpha-value>)',
          100: 'hsl(var(--grey-100) / <alpha-value>)',
          200: 'hsl(var(--grey-200) / <alpha-value>)',
          300: 'hsl(var(--grey-300) / <alpha-value>)',
          400: 'hsl(var(--grey-400) / <alpha-value>)',
          500: 'hsl(var(--grey-500) / <alpha-value>)',
        },
        error:   'hsl(var(--error)   / <alpha-value>)',
        success: 'hsl(var(--success) / <alpha-value>)',
        warning: 'hsl(var(--warning) / <alpha-value>)',
        info:    'hsl(var(--info)    / <alpha-value>)',

        // ─── Compatibility aliases for older code ─────────────────────────────
        brand: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          hover:   'hsl(var(--primary-dark) / <alpha-value>)',
          light:   'hsl(var(--primary-light) / <alpha-value>)',
        },
        base: {
          DEFAULT: 'hsl(var(--background) / <alpha-value>)',
          50:      'hsl(var(--grey-50)    / <alpha-value>)',
          100:     'hsl(var(--grey-100)   / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'hsl(var(--background-paper) / <alpha-value>)',
          raised:  'hsl(var(--grey-20)          / <alpha-value>)',
          overlay: 'hsl(var(--grey-50)          / <alpha-value>)',
        },
        border: {
          DEFAULT: 'hsl(var(--grey-100) / <alpha-value>)',
          strong:  'hsl(var(--grey-200) / <alpha-value>)',
        },
        'text-muted': 'hsl(var(--text-secondary) / <alpha-value>)',
      },
      fontFamily: {
        sans:    ['Mulish', 'ui-sans-serif', 'sans-serif'],
        heading: ['Urbanist', 'ui-sans-serif', 'sans-serif'],
        mono:    ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        '2xs': 'var(--border-radius-2xs)',
        xs:    'var(--border-radius-xs)',
        sm:    'var(--border-radius-sm)',
        md:    'var(--border-radius-md)',
        lg:    'var(--border-radius-lg)',
        xl:    'var(--border-radius-xl)',
        '2xl': 'var(--border-radius-2xl)',
        '3xl': 'var(--border-radius-3xl)',
        '4xl': 'var(--border-radius-4xl)',
      },
      boxShadow: {
        'darker-xs': 'var(--shadow-darker-xs)',
        'darker-sm': 'var(--shadow-darker-sm)',
        'darker-md': 'var(--shadow-darker-md)',
        xs:          'var(--shadow-xs)',
        sm:          'var(--shadow-sm)',
      },
      backgroundImage: {
        waves: 'var(--bg-waves)',
      },
    },
  },
  plugins: [],
} satisfies Config
