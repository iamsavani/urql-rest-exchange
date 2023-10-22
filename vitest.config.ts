import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    setupFiles: [resolve(__dirname, 'scripts/vitest.js')],
    clearMocks: true,
    coverage: {
      provider: 'v8', // or 'v8'
    },
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress}.config.*',
    ],
  },
});
