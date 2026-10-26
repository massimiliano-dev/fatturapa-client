import { defineConfig } from 'vitest/config';

// The "@massimiliano-dev/source" export condition maps workspace packages to their TypeScript sources,
// so tests never depend on a previous build.
const conditions = ['@massimiliano-dev/source', 'module', 'node', 'development|production'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts'],
          exclude: ['**/*.live.test.ts', '**/node_modules/**'],
          environment: 'node',
        },
      },
      {
        // Smoke tests against the real provider sandboxes. Skipped unless the credential variables are
        // set: see CONTRIBUTING.md. Never run against production.
        extends: true,
        test: {
          name: 'live',
          include: ['packages/*/test/**/*.live.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 60_000,
        },
      },
    ],
  },
});
