/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#2D5F5D',
        'primary-dark': '#1E3F3E',
        background: '#FFFFFF',
        surface: '#F8F9FA',
        text: '#1A1A1A',
        'text-muted': '#6C757D',
        success: '#28A745',
        warning: '#FFC107',
        error: '#DC3545',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}