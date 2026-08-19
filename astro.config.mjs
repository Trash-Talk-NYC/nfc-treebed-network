// @ts-check
import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import node from '@astrojs/node';

// Two build targets, one app:
//
//  - `netlify` — the deployed pilot (wayfinder #8): server routes become
//    Netlify Functions. netlify.toml sets TREEBED_ADAPTER for every Netlify
//    build, and NETLIFY=true catches a build started by the platform some
//    other way.
//  - `node` (default) — the standalone server `npm start`, `npm run preview`
//    and the end-to-end suite run. The request-body bounds are measured
//    against this runtime's real sockets (tests/report-upload.e2e.test.ts),
//    so the node target stays first-class rather than becoming a dev shim.
const target = process.env.TREEBED_ADAPTER ?? (process.env.NETLIFY === 'true' ? 'netlify' : 'node');

// Server-rendered on purpose: the plaque must be complete in the initial
// HTML (spec §3a — no client-side fetch waterfall on first paint).
export default defineConfig({
  output: 'server',
  adapter: target === 'netlify' ? netlify() : node({ mode: 'standalone' }),
  server: { port: 4321 },
  // One request to first paint (spec §3a): critical CSS ships inline.
  build: { inlineStylesheets: 'always' },
});
