import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// The build is served by the Hono backend in production. Output lands in
// ../public/app and Vite's own JS/CSS go under /static so they never collide
// with the logo assets the backend already serves from /assets.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Icons are served by the backend from /assets, not bundled by Vite, so
      // don't try to precache them from the build output.
      includeManifestIcons: false,
      manifest: {
        name: 'Kerygma — Sermon Library',
        short_name: 'Kerygma',
        description: 'Search and chat with the church sermon library.',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/assets/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/assets/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/assets/maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the app shell (hashed JS/CSS + index.html under public/app).
        globPatterns: ['**/*.{js,css,html}'],
        navigateFallback: '/index.html',
        // Never hijack the backend's data/stream routes with the SPA shell.
        navigateFallbackDenylist: [/^\/api\//, /^\/mcp/, /^\/assets\//, /^\/health/, /\/download$/],
        runtimeCaching: [
          {
            // Public, read-only transcript JSON + search — usable after first load.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/transcripts/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'transcripts',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname === '/api/themes',
            handler: 'NetworkFirst',
            options: { cacheName: 'themes', expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 } },
          },
          {
            // Logos/icons served by the backend.
            urlPattern: ({ url }) => url.pathname.startsWith('/assets/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'assets', expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 7 } },
          },
        ],
        // The agentic chat (POST /api/chat, SSE) and all secret-gated admin/DB
        // endpoints are deliberately NOT cached — they are live and/or private,
        // so they fall through to plain network requests.
      },
    }),
  ],
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
