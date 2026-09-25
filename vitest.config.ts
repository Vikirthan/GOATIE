import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)', 'api/**/*.{test,spec}.?(c|m)[jt]s?(x)', 'supabase/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    // API + SQL tests run in node via per-file @vitest-environment comments.
    environmentMatchGlobs: [
      ['api/**', 'node'],
      ['supabase/**', 'node'],
    ],
    testTimeout: 15000,
    // Never hit the real backend from tests, even if .env is loaded.
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
  },
});
