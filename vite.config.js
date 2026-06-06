import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api-fred': {
        target: 'https://api.stlouisfed.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-fred/, '')
      },
      '/api-alphavantage': {
        target: 'https://www.alphavantage.co',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-alphavantage/, '')
      },
      '/api-coinmetrics': {
        target: 'https://community-api.coinmetrics.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-coinmetrics/, '')
      },
      '/api-bitbo': {
        target: 'https://bitbo.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-bitbo/, '')
      }
    }
  }
})
