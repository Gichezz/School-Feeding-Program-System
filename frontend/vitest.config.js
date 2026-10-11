import { defineConfig } from 'vitest/config';

// Unit tests for the offline storage and sync modules.
// Kept separate from vite.config.js so the PWA plugin is not loaded during tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    setupFiles: ['./src/test/setup.js'],
    restoreMocks: true,
  },
});
