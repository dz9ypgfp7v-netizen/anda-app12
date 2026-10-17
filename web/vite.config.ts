import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// VITE_APP_MODE=demo      → la base corre dentro del navegador (PGlite). Sin servidor, sin cuentas reales.
// VITE_APP_MODE=supabase  → usa tu proyecto de Supabase (VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const appMode = env.VITE_APP_MODE || 'demo';
  return {
    plugins: [
      react(),
      // En producción (Supabase) no hace falta el motor de la demo: no se publica (ahorra ~16 MB).
      {
        name: 'anda-drop-demo-engine',
        apply: 'build' as const,
        generateBundle(_o: unknown, bundle: Record<string, unknown>) {
          if (appMode !== 'supabase') return;
          for (const k of Object.keys(bundle)) if (/\.(wasm|data)$/.test(k)) delete bundle[k];
        },
      },
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.png', 'icons/apple-touch-icon.png'],
        manifest: {
          name: 'ANDÁ',
          short_name: 'ANDÁ',
          description: 'Movete a tu manera. Caminá, visitá comercios, sumá PASOS y canjealos por premios.',
          lang: 'es-AR',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#0A1620',
          theme_color: '#0F2A43',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
          navigateFallback: '/index.html',
          runtimeCaching: [
            // motor de la base del modo demo (pesado): se guarda al primer uso
            { urlPattern: /\.(wasm|data)$/, handler: 'CacheFirst', options: { cacheName: 'anda-demo-engine', expiration: { maxEntries: 8 } } },
          ],
        },
      }),
    ],
    define: { __APP_MODE__: JSON.stringify(appMode) },
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
    server: { fs: { allow: ['..'] }, port: 5173 },
    build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 6000 },
  };
});
