import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Entwicklung: Vite auf 4173 leitet API, WebSocket, Mailpit und Kacheln an die API auf 4100 weiter.
// Test/Produktion: `vite build` → build/, die API liefert das Verzeichnis statisch aus (SPA-Fallback).
const api = 'http://127.0.0.1:4100';

export default defineConfig({
  plugins: [
    sveltekit({
      compilerOptions: {
        runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
      },
      adapter: adapter({ fallback: 'index.html', strict: false }),
    }),
  ],
  server: {
    proxy: {
      '/api': api,
      '/ws': { target: api, ws: true },
      '/mailpit': { target: api, ws: true },
      '/tiles': api,
    },
  },
});
