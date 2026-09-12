// Saving the digest cadence — the "x frequency" the captain has not picked
// yet, stored as a network setting so picking one is an admin edit rather
// than a deploy (types.ts, `NetworkSettings`).
//
// A POST from the small form on the admin index, behind the admin session
// like everything else on this surface. The form's radios are the only
// values this accepts; anything else is a hand-built request and refuses
// without writing.

import type { APIRoute } from 'astro';

import { requireAdmin } from '../../lib/admin-route';
import { langLink, resolveLang } from '../../lib/i18n';
import { MAX_FORM_BYTES, readFormOrRefuse } from '../../lib/request-body';
import { getStore } from '../../lib/store';
import { postOnly } from '../../lib/tag-route';
import { DIGEST_CADENCES, type DigestCadence } from '../../lib/types';

export const POST: APIRoute = async ({ request, cookies, url }) => {
  const lang = resolveLang(url, cookies);
  const gate = await requireAdmin(request, cookies, langLink('/admin', lang));
  if (gate.refused) return gate.refused;

  const { form, refused } = await readFormOrRefuse(request, MAX_FORM_BYTES, 'digest cadence');
  if (refused) return refused;
  const asked = String(form.get('digestCadence') ?? '');
  if (!(DIGEST_CADENCES as readonly string[]).includes(asked)) {
    return new Response('Not a digest cadence.', { status: 422 });
  }
  const store = getStore();
  await store.transaction(async (tx) => {
    const settings = await tx.getNetworkSettings();
    await tx.updateNetworkSettings({ ...settings, digestCadence: asked as DigestCadence });
  });
  // Back to the index with the same saved note the block page uses.
  return new Response(null, {
    status: 303,
    headers: { location: langLink('/admin?saved=1', lang) },
  });
};

// 405 for anything else, rather than Astro's own 404 with a log line per
// request (tag-route.ts).
export const ALL = postOnly;
