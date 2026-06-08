/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#2f6f3e',
        background: '#f8f5f0',
        surface: '#ffffff',
        border: '#e5e5e5',
        text: '#1a1a1a',
        muted: '#667085',
        success: '#208452',
        warning: '#b7791f',
        error: '#c2412d',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
