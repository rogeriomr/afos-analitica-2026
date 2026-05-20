import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for AFOS unit tests.
 *
 * Lives alongside the existing Playwright config (which targets `./tests`)
 * without collision: Vitest only picks up files under
 * `app/** /__tests__/** /*.{test,spec}.ts` (the __tests__ folder convention),
 * and Playwright only picks up `./tests/**`.
 *
 * Rules are pure functions with no DOM dependencies, so the `node`
 * environment is used.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['app/**/__tests__/**/*.{test,spec}.ts'],
    // Exclude the Playwright e2e directory and standard noise to be defensive.
    exclude: ['node_modules/**', '.next/**', 'tests/**', 'dist/**'],
  },
});
