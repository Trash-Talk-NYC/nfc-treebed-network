// Clearing a steward's digest opt-out — the recovery half of the
// unsubscribe link. The emailed link is the only other writer of
// `User.digestOptedOut`, and a mail scanner can trip it without the
// steward knowing; this is the admin control that puts their digest back,
// with their say-so (the button's own sub-line says exactly that).
//
// Behind the admin session like everything on this surface, and scoped to
// the block page it is pressed from: the steward named must hold an active
// adoption on a bed of this block, so the route cannot be used to walk
// user ids at large.

import type { APIRoute } from 'astro';

import { requireAdmin } from '../../../../lib/admin-route';
import { langLink, resolveLang } from '../../../../lib/i18n';
import { MAX_FORM_BYTES, readFormOrRefuse } from '../../../../lib/request-body';
import { getStore } from '../../../../lib/store';
import { postOnly } from '../../../../lib/tag-route';

export const POST: APIRoute = async ({ request, cookies, url, params }) => {
  const lang = resolveLang(url, cookies);
  const gate = await requireAdmin(request, cookies, langLink('/admin', lang));
  if (gate.refused) return gate.refused;

  const { form, refused } = await readFormOrRefuse(request, MAX_FORM_BYTES, 'digest resume');
  if (refused) return refused;
  const blockId = params.block ?? '';
  const plate = String(form.get('bed') ?? '');
  const stewardId = String(form.get('steward') ?? '');
  const store = getStore();
  await store.transaction(async (tx) => {
    const bed = await tx.getBed(plate);
    if (!bed || bed.blockId !== blockId) return;
    const holds = (await tx.getActiveAdoptions(plate)).some((a) => a.userId === stewardId);
    if (!holds) return;
    const user = await tx.getUser(stewardId);
    if (user && user.digestOptedOut) {
      await tx.updateUser({ ...user, digestOptedOut: false });
    }
  });
  // Back to the steward panel either way: a press that matched nothing
  // changed nothing, and the panel shows the state as it stands.
  //
  // Built with URLSearchParams rather than interpolation because `bed` and
  // `steward` come off the form: an `&` or a `#` in one would silently retarget
  // the redirect, and a CR/LF would make the Response constructor throw and
  // turn an admin press into a 500.
  const back = new URLSearchParams({ bed: plate, steward: stewardId });
  return new Response(null, {
    status: 303,
    headers: {
      location: langLink(
        `/admin/blocks/${encodeURIComponent(blockId)}?${back.toString()}`,
        lang,
      ),
    },
  });
};

// 405 for anything else, rather than Astro's own 404 with a log line per
// request (tag-route.ts).
export const ALL = postOnly;
