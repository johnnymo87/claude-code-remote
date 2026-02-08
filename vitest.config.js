import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    globals: true,
    testTimeout: 10000,
    setupFiles: ['./test/setup.js'],
  },
});
