import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  build: { outDir: 'dist', emptyOutDir: true },
  // The API is same-origin in production; in dev, Vite proxies so the session cookie is
  // set on one origin and no CORS rule has to exist for a case production never has.
  server: { proxy: { '/api': 'http://localhost:8730', '/healthz': 'http://localhost:8730' } },
})
