delete process.env.ELECTRON_RUN_AS_NODE;

import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@grabbit/core', '@grabbit/config', '@grabbit/types', '@grabbit/utils'],
      }),
    ],
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@grabbit/core', '@grabbit/config', '@grabbit/types', '@grabbit/utils'],
      }),
    ],
  },
  renderer: {
    plugins: [react()],
  },
});
