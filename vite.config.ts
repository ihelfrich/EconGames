import { defineConfig } from 'vite';

export default defineConfig({
  base: '/EconGames/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
          chart: ['chart.js']
        }
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
});
