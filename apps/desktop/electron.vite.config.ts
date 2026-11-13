delete process.env.ELECTRON_RUN_AS_NODE;

import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@grabbit/core', '@grabbit/config', '@grabbit/schemas', '@grabbit/types', '@grabbit/utils'],
      }),
    ],
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@grabbit/core', '@grabbit/config', '@grabbit/schemas', '@grabbit/types', '@grabbit/utils'],
      }),
    ],
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            const normalized = id.replace(/\\/g, '/');
            if (!normalized.includes('/node_modules/')) return undefined;
            if (normalized.includes('/react/') || normalized.includes('/react-dom/') || normalized.includes('/scheduler/')) {
              return 'react';
            }
            if (normalized.includes('/motion/') || normalized.includes('/framer-motion/') || normalized.includes('/motion-dom/') || normalized.includes('/motion-utils/')) {
              return 'motion';
            }
            if (normalized.includes('/lucide-react/')) {
              return 'icons';
            }
            return undefined;
          },
        },
      },
    },
  },
});
