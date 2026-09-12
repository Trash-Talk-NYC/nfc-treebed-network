// POST: the steward's bed-name form on `mine.astro` — "from the mine page
// they should be able to rename the tree bed", and "any steward can rename
// it" (the captain, 2026-09-12). A plain HTML form POST, like every other
// action here, so renaming works with JavaScript disabled.
//
// Gated like /clear: a session, and that session holding an active adoption
// on THIS bed — the body is read under the text-form bounds first, so an
// unauthenticated POST is bounded and writes nothing. The rule itself
// (`renameBedBySteward`) re-checks the steward inside its transaction and
// appends a `rename` event, so who changed the name, when, and to what is on
// the record.
import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store';
import { RuleError, getBedView, renameBedBySteward } from '../../../lib/service';
import { getSessionUserId } from '../../../lib/session';
import { MAX_FORM_BYTES, readFormOrRefuse } from '../../../lib/request-body';
import { ourPlaqueLink } from '../../../lib/plaque-url';
import { langLink, readLang } from '../../../lib/i18n';
import { refuseWithBody, requireBoundTagForPost, postOnly } from '../../../lib/tag-route';

export const POST: APIRoute = async ({ params, request, cookies, redirect, url }) => {
  // Resolved before anything else, and its body accounted for either way: a
  // POST at a tag nobody bound has no bed behind it, and a body left untouched
  // is one Node dumps to its end for us.
  const { bound, refused: unbound } = await requireBoundTagForPost(params.tag, request);
  if (unbound) return unbound;
  const { plate, base } = bound;
  const { form, refused } = await readFormOrRefuse(request, MAX_FORM_BYTES, 'bed name');
  if (refused) return refused;
  const lang = readLang(url, cookies);
  const userId = getSessionUserId(cookies);
  // The steward's own view logs no tap; the plaque does, so the way back for
  // anyone else carries the flag that says this render is our redirect.
  const plaque = langLink(ourPlaqueLink(base), lang);
  if (!userId) return redirect(plaque, 303);

  const store = getStore();
  const view = await getBedView(store, plate);
  if (!view) {
    return await refuseWithBody(request, new Response('No bed with that plate.', { status: 404 }));
  }
  if (!view.stewards.some((s) => s.user.id === userId)) return redirect(plaque, 303);

  const back = langLink(`${base}/mine`, lang);
  try {
    await renameBedBySteward(store, { plate, userId, name: String(form.get('name') ?? '') });
    return redirect(langLink(`${base}/mine?renamed=1`, lang), 303);
  } catch (err) {
    if (err instanceof RuleError && err.code === 'invalid-input') {
      // An empty name. This is the steward's own screen, not a passer-by's,
      // so it says so there — the one place the field is.
      return redirect(langLink(`${base}/mine?rename=empty`, lang), 303);
    }
    // A steward released between the check above and the transaction: back to
    // their view, which will bounce them to the public screen itself.
    if (err instanceof RuleError && err.code === 'not-steward') return redirect(back, 303);
    if (err instanceof RuleError && err.code === 'bed-not-found') {
      // The rule's own message names the plate, which encodes site type and
      // neighbourhood and is never rendered to a visitor. A retired bed makes
      // this a normal state — a stale screen submitting — not a registry typo.
      return new Response('No bed with that plate.', { status: 404 });
    }
    throw err;
  }
};

export const ALL = postOnly;
