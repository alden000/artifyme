import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '1.0.0') },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg', 'styles/*.webp'],
      manifest: {
        id: './',
        name: 'ArtifyMe — Become the Masterpiece',
        short_name: 'ArtifyMe',
        description: 'Have your photos redrawn by the great masters with private, on-device AI.',
        theme_color: '#0a090d',
        background_color: '#0a090d',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        categories: ['photo', 'entertainment', 'lifestyle'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Masterpiece+ keeps its own weight cache (artifyme-mp-v2); the service worker only stores the app shell.
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,webp}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // AI runtime (WebAssembly) for Masterpiece+.
            urlPattern: ({ url }) => url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: { cacheName: 'artifyme-runtime-v1', cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
});
