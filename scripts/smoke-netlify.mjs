// Boot gate for the netlify target: import the emitted function and render
// one request through it.
//
// `TREEBED_ADAPTER=netlify astro build` proves the adapter resolves and the
// bundle emits, which is not the failure this repo actually hit — an adapter
// satisfying its peer range and then calling an astro API that isn't there
// crashes when the built server is *loaded*, and builds perfectly green.
// `npm run test:e2e` covers that for the node target by starting
// dist/server/entry.mjs and posting at it; this is the netlify target's
// equivalent, and the reason CI's netlify build is a gate rather than a
// spelling check.
//
// The root redirect is the request it drives because it is the one route that
// reaches a rendered response without touching the store, so this needs no
// Blobs backend — what is being proved is that the handler loads, the
// middleware runs and the app renders, not what the dataset holds.
import { fileURLToPath } from 'node:url';

const FUNCTION_ENTRY = new URL('../.netlify/v1/functions/ssr/ssr.mjs', import.meta.url);

function fail(message) {
  console.error(`netlify smoke: ${message}`);
  process.exit(1);
}

const { default: createHandler } = await import(FUNCTION_ENTRY.href).catch((err) => {
  fail(`the built function at ${fileURLToPath(FUNCTION_ENTRY)} could not be loaded — ${err}`);
});

const handler = typeof createHandler === 'function' ? createHandler : null;
if (handler === null) fail('the built function has no default export to invoke.');

// The adapter reads `context.ip` for Astro's clientAddress.
const response = await handler(new Request('https://treebed-plaque.test/'), { ip: '127.0.0.1' });

if (response.status !== 302) {
  fail(`GET / answered ${response.status}, expected the 302 redirect to the seeded bed.`);
}
const location = response.headers.get('location');
if (!location?.startsWith('/b/')) {
  fail(`GET / redirected to ${location ?? '(nothing)'}, expected a plaque URL.`);
}

console.log(`netlify smoke: the built function boots and answers GET / with 302 ${location}.`);
