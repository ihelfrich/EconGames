import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/EconGames/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        twin: resolve(__dirname, 'twin.html'),
      },
      output: {
        manualChunks: {
          phaser: ['phaser'],
          chart: ['chart.js']
        }
      }
    }
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 3000,
    open: true
  }
});
