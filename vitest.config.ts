import { configDefaults, defineConfig } from 'vitest/config';

// The fast suite: server-side rules and transport handling, no build, no
// server, runnable on every save. The end-to-end checks build the app and
// spawn `dist/server/entry.mjs`, which costs tens of seconds — a suite people
// avoid running is worse than a slightly smaller one, so they live behind
// `npm run test:e2e` (vitest.e2e.config.ts) and CI runs both.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.e2e.test.ts'],
  },
});
