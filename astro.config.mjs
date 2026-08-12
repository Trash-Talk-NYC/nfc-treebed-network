// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// Server-rendered on purpose: the plaque must be complete in the initial
// HTML (spec §3a — no client-side fetch waterfall on first paint).
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 4321 },
  // One request to first paint (spec §3a): critical CSS ships inline.
  build: { inlineStylesheets: 'always' },
});
