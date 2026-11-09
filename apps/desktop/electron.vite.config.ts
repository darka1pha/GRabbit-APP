import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    build: {
      // shazamio-core loads its .wasm from its own folder at runtime, so keep it external
      externalizeDeps: true,
    },
  },
  preload: {},
  renderer: {
    plugins: [react()],
  },
});
