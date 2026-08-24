import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#1a1b4b', // Deep Navy Blue
          secondary: '#e8e4ff', // Soft Lavender
          accent: '#ffb020', // Bright Yellow/Orange
          surface: '#f8f9fa', // Off-white background
        },
        urgency: {
          high: {
            bg: '#fee2e2', // red-100
            text: '#b91c1c', // red-700
          },
          medium: {
            bg: '#fef3c7', // amber-100
            text: '#b45309', // amber-700
          },
          low: {
            bg: '#dcfce7', // green-100
            text: '#15803d', // green-700
          }
        },
        status: {
          pending: {
            bg: '#e0f2fe', // sky-100
            text: '#0369a1', // sky-700
          },
          failed: {
            bg: '#fee2e2', // red-100
            text: '#b91c1c', // red-700
          },
          success: {
            bg: '#dcfce7', // green-100
            text: '#15803d', // green-700
          }
        }
      },
      borderRadius: {
        'xl': '1rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
        'pill': '9999px',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
export default config
