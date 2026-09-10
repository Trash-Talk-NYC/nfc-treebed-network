// Closing the admin session on this device.
//
// The 30-day `tg_admin` cookie opens every steward's full name, email and
// phone (session.ts). The captain runs this page from a phone on the
// sidewalk and hands it over to write a neighbour in, so the session needs a
// door out that is neither "clear your site data" nor rotating
// `TREEBED_ADMIN_KEY`, which signs out every device at once.
//
// A POST, because it changes state, and a plain form on every admin screen
// so it works with no script.

import type { APIRoute } from 'astro';

import { requireAdmin } from '../../lib/admin-route';
import { langLink, resolveLang } from '../../lib/i18n';
import { abandonBody } from '../../lib/request-body';
import { clearAdminSession } from '../../lib/session';
import { postOnly } from '../../lib/tag-route';

export const POST: APIRoute = async ({ request, cookies, url }) => {
  const lang = resolveLang(url, cookies);
  const keyScreen = langLink('/admin', lang);
  const gate = await requireAdmin(request, cookies, keyScreen);
  if (gate.refused) return gate.refused;
  // The press carries no fields, so there is nothing to read — only the body
  // to account for, the same way every refusal on this surface does.
  await abandonBody(request);
  clearAdminSession(cookies);
  return new Response(null, { status: 303, headers: { location: keyScreen } });
};

// 405 for anything else, rather than Astro's own 404 with a log line per
// request (tag-route.ts).
export const ALL = postOnly;
