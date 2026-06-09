import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The build is served by the Hono backend in production. Output lands in
// ../public/app and Vite's own JS/CSS go under /static so they never collide
// with the logo assets the backend already serves from /assets.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: '../public/app',
    emptyOutDir: true,
    assetsDir: 'static',
  },
  server: {
    port: 5173,
    // In dev, Vite serves the SPA and proxies everything the backend owns to
    // the Hono server on :3000 (API, SSE chat, PDF downloads, logos, MCP).
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/assets': { target: 'http://localhost:3000', changeOrigin: true },
      '/health': { target: 'http://localhost:3000', changeOrigin: true },
      '/mcp': { target: 'http://localhost:3000', changeOrigin: true },
      // PDF download links point at the backend route directly.
      '^/transcripts/.+/download$': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
})
