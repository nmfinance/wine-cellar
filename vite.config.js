import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Сайт живёт на GitHub Pages по подпути https://<username>.github.io/wine-cellar/
// base обязан совпадать со scope/start_url манифеста — иначе PWA ломается.
export default defineConfig({
  base: '/wine-cellar/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // prompt: обновление применяется по тапу на тост «Доступна новая версия»
      // (P21), а не молча при следующем открытии
      registerType: 'prompt',
      workbox: {
        // включая favicon.svg и apple-touch-icon, чтобы офлайн был полным
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
      },
      manifest: {
        name: 'Мой погреб',
        short_name: 'Погреб',
        description: 'Личный винный погреб с дегустационными заметками',
        lang: 'ru',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#722F37',
        background_color: '#722F37',
        scope: '/wine-cellar/',
        start_url: '/wine-cellar/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
});
