import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [
    // FAZ 15.3 — PWA: çevrimdışı çalışma + mobil install
    VitePWA({
      registerType: 'autoUpdate',      // yeni sürüm sessizce güncellenir
      injectRegister: 'auto',          // register script index.html'e otomatik enjekte
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Süt Sığırı Rasyon Programı',
        short_name: 'Rasyon Programı',
        description: 'NRC 2001 / NASEM 2021 / CNCPS v6.5 tabanlı süt sığırı rasyon optimizasyonu',
        lang: 'tr',
        dir: 'ltr',
        theme_color: '#2d7d46',
        background_color: '#f5f7f5',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['agriculture', 'productivity', 'business'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Tüm uygulama varlıkları precache (çevrimdışı çalışma için WASM + font dahil)
        globPatterns: ['**/*.{js,css,html,svg,wasm,woff,woff2}'],
        // PDF/Excel dinamik chunk'ları büyük → precache limitini yükselt
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // PDF Türkçe fontu (DejaVu, jsDelivr CDN) — ilk çevrimiçi kullanımdan sonra cache
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'jsdelivr-cdn',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // SW yalnızca production build'de aktif. Dev'de kapalı: HMR ile SW cache
        // çakışmasını (stale asset sürprizi) önler. PWA bir production özelliğidir;
        // doğrulama `npm run build` + `npm run preview` ile yapılır.
        enabled: false,
        type: 'module',
      },
    }),
  ],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html',
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup/indexeddb.js'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/core/**', 'src/solver/**', 'src/data/**'],
    },
  },
  worker: {
    format: 'es',
  },
});
