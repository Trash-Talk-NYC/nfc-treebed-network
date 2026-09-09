// POST: "SEND APPLAUSE" — the one thing a passer-by can do for a bed that is
// fine. A plain HTML form POST, like every other action here.
import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store';
import { RuleError, sendApplause } from '../../../lib/service';
import { getExistingActorId } from '../../../lib/session';
import { discardBody } from '../../../lib/request-body';
import { langLink, readLang } from '../../../lib/i18n';
import { ourPlaqueLink } from '../../../lib/plaque-url';
import { requireBoundTagForPost, postOnly } from '../../../lib/tag-route';

export const POST: APIRoute = async ({ params, request, cookies, redirect, url }) => {
  // Resolved before anything else, and its body accounted for either way: a
  // POST at a tag nobody bound has no bed behind it, and a body left untouched
  // is one Node dumps to its end for us.
  const { bound, refused: unbound } = await requireBoundTagForPost(params.tag, request);
  if (unbound) return unbound;
  const { plate, base } = bound;
  const lang = readLang(url, cookies);
  const refused = await discardBody(request, 'applause');
  if (refused) return refused;
  // A write a cookie-less caller can repeat costs an append-only event apiece
  // and bounds nothing.
  // Minting here would hand a caller that discards cookies a fresh identity
  // every request, and "once a day per person" would bound nothing at all. A
  // neighbour standing at the tree always has one — the door screen they
  // pressed the button on set it — so this costs nobody their applause.
  // `/report` is the deliberate exception (AGENTS.md): filing is the product.
  const actorId = getExistingActorId(cookies);
  if (!actorId) return redirect(langLink(ourPlaqueLink(base), lang), 303);
  try {
    // Whether it counted or was today's second press, the screen is the same:
    // there is nothing here worth showing somebody a rule about.
    await sendApplause(getStore(), { plate, actorId });
    return redirect(langLink(`${base}/thanks?applause=1`, lang), 303);
  } catch (err) {
    if (err instanceof RuleError && err.code === 'bed-not-found') {
      return new Response(err.message, { status: 404 });
    }
    throw err;
  }
};

export const ALL = postOnly;
