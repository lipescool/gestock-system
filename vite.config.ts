import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Chemins relatifs : l'application peut être servie depuis un sous-dossier
  // ou une clé USB sans reconfiguration.
  base: './',

  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['fonts/*.ttf'],
      manifest: {
        name: 'Gestock',
        short_name: 'Gestock',
        description: 'Gestion de boutique hors ligne : caisse, stock, dépenses.',
        lang: 'fr',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#ffffff',
        theme_color: '#1f8a70',
        categories: ['business', 'productivity', 'finance'],
        icons: [
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Tout est mis en cache à l'installation : l'application doit
        // démarrer sans réseau dès la deuxième ouverture.
        globPatterns: ['**/*.{js,css,html,ttf,woff2,png,svg,ico}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Le nouveau service worker prend la main immédiatement : sans
        // cela, il faut fermer tous les onglets pour voir une mise à jour.
        skipWaiting: true,
        clientsClaim: true,
        // Aucune requête réseau n'est attendue : pas de runtimeCaching.
      },
      // Service worker actif en développement : sans lui, Chrome refuse
      // d'installer l'application et le bouton « Installer » ne sert à rien.
      //
      // Mais en mode « generateSW », il met le code en cache et sert alors
      // une version périmée à chaque rechargement. On passe donc par un
      // service worker minimal en développement : il suffit à rendre
      // l'installation possible, sans jamais intercepter les fichiers.
      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
        suppressWarnings: true,
      },
    }),
  ],

  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
});
