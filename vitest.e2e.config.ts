import { defineConfig } from 'vitest/config';

// The end-to-end suite: builds the app, serves the production bundle, and
// posts real bodies over a real socket. Kept apart from `npm test` because it
// is slow and writes to `dist/`, and run without file parallelism so nothing
// else is competing for the box while an upload's pacing is being measured.
export default defineConfig({
  test: {
    include: ['tests/**/*.e2e.test.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
