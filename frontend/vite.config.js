import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Vite config for the React PWA.
// Service worker registration is handled by vite-plugin-pwa.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-192.png', 'pwa-512.png'],
      manifestFilename: 'manifest.webmanifest',
      manifest: {
        name: 'Lishe – School Feeding',
        short_name: 'Lishe',
        description:
          'Every meal counted, even offline. Daily feeding and food stock records for school feeding programmes.',
        // Botanical pine and warm off-white (--color-brand and --color-bg in src/styles/tokens.css)
        theme_color: '#14362b',
        background_color: '#faf9f6',
        lang: 'en',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the app shell, fonts and icons so Lishe opens offline
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // Forward API calls to the Express backend during local development
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
