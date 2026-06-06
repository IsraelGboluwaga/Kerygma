import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const dir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  root: dir,
  publicDir: resolve(dir, 'public'),
  build: {
    outDir: resolve(dir, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/health': { target: 'http://localhost:3000', changeOrigin: true },
      '/mcp': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
})
