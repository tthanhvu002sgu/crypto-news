import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VERCEL ? "/" : "/crypto-news/",
  plugins: [react()],
  server: {
    proxy: {
      '/api-fred': {
        target: 'https://api.stlouisfed.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-fred/, '')
      },
      '/api-fred-graph': {
        target: 'https://fred.stlouisfed.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-fred-graph/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
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
      },
      '/api-yahoo': {
        target: 'https://query2.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-yahoo/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      }
    }
  }
})
