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
// Two requests, neither of which needs a Blobs backend — what is being proved
// is that the handler loads, the middleware runs and the app renders, not what
// the dataset holds:
//
//   /t/<invalid>  an ID no normalization can resolve, answered 404 in plain
//                 text before any store read. The handler loading, the
//                 middleware running and a route answering, with nothing
//                 behind it that a missing backend can break.
//   /             the root, which DOES consult the store (it redirects to the
//                 demo tag only while that binding still names a live bed) and
//                 is built not to fail when it cannot: with no backend here it
//                 falls to the calm bilingual screen at 200, which is a full
//                 render through the layout. Either answer — the 302 where a
//                 store answered, the rendered 200 where none could — proves
//                 the app renders.
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
// A handler that loads and then throws while rendering — the middleware's own
// session-secret assertion is the likeliest one locally — is this script's
// failure to report, not node's: an unhandled rejection reads as a broken
// gate rather than a missing variable.
async function render(path) {
  try {
    return await handler(new Request(`https://treebed-plaque.test${path}`), { ip: '127.0.0.1' });
  } catch (err) {
    return fail(`the built function loaded but threw while rendering GET ${path} — ${err}`);
  }
}

// An ID carrying `u`, which the Crockford alphabet has no mapping for, so no
// binding and no store read can be reached from it.
const refused = await render('/t/uuuuuuuu');
if (refused.status !== 404) {
  fail(`GET /t/uuuuuuuu answered ${refused.status}, expected the plain-text 404.`);
}

const root = await render('/');
if (root.status === 302) {
  const location = root.headers.get('location');
  if (!location?.startsWith('/t/')) {
    fail(`GET / redirected to ${location ?? '(nothing)'}, expected a plaque URL.`);
  }
  console.log(`netlify smoke: the built function boots, refuses an invalid tag 404, and answers GET / with 302 ${location}.`);
} else if (root.status === 200) {
  const html = await root.text();
  if (!/<!doctype html>/i.test(html) || !html.includes('</html>')) {
    fail('GET / answered 200 without a rendered document, expected the calm root screen.');
  }
  console.log('netlify smoke: the built function boots, refuses an invalid tag 404, and renders the calm root screen at 200.');
} else {
  fail(`GET / answered ${root.status}, expected the 302 to the demo bed or the calm screen at 200.`);
}
