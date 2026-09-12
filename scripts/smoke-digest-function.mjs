// Boot gate for the scheduled digest function.
//
// netlify/functions/digest.mts is the one piece of this app Netlify bundles
// with its OWN esbuild at deploy time, outside the Astro/Vite build — and it
// reaches across into src/lib (store, digest, mail, copy, unsubscribe-link,
// tag-bindings). Nothing else in CI builds or loads it: `astro check` only
// type-checks it, `astro build` never sees it, and smoke-netlify.mjs gates the
// SSR function alone. A resolution or load failure would therefore first
// surface as a scheduled run that silently did nothing in production.
//
// So this bundles it the way Netlify does and imports the result. It does NOT
// invoke the handler: the run needs a Blobs backend and would attempt real
// mail, and the captain's instruction is that nothing sends. What is being
// proved is that every import resolves, the bundle emits, and the module
// evaluates — which is exactly the class of break the SSR smoke exists for.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

function fail(message) {
  console.error(`digest smoke: ${message}`);
  process.exit(1);
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const entry = path.join(repoRoot, 'netlify/functions/digest.mts');
const outDir = await mkdtemp(path.join(tmpdir(), 'treebed-digest-smoke-'));
const outFile = path.join(outDir, 'digest.mjs');

try {
  // The shape Netlify's zip-it-and-ship-it uses for a .mts function: esbuild,
  // bundled, ESM, node platform, node builtins external (which `platform:
  // 'node'` already implies) and everything else — @netlify/blobs included —
  // pulled into the bundle.
  await build({
    entryPoints: [entry],
    outfile: outFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  }).catch((err) => fail(`the function could not be bundled — ${err}`));

  const mod = await import(pathToFileURL(outFile).href).catch((err) =>
    fail(`the bundled function could not be loaded — ${err}`),
  );

  if (typeof mod.default !== 'function') {
    fail('the bundled function has no default export to schedule.');
  }
  if (mod.config?.schedule !== '0 11 * * *') {
    fail(`the bundled function's schedule is ${mod.config?.schedule ?? '(missing)'}, expected "0 11 * * *".`);
  }
  console.log(`digest smoke: the scheduled function bundles and loads, on "${mod.config.schedule}".`);
} finally {
  await rm(outDir, { recursive: true, force: true });
}
