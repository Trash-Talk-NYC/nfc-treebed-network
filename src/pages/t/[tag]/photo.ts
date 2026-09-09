// POST: "GIVE THIS WEEK'S PHOTO". Records the weekly photo as an append-only
// event. Image capture/storage and point earning are out of MVP scope
// (task brief) — only the fact of the photo is kept, once per NY week.
import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store';
import { getBedView, logPhoto } from '../../../lib/service';
import { getSessionUserId } from '../../../lib/session';
import { discardBody } from '../../../lib/request-body';
import { ourPlaqueLink } from '../../../lib/plaque-url';
import { refuseWithBody, requireBoundTagForPost } from '../../../lib/tag-route';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  // Resolved before anything else, and its body accounted for either way: a
  // POST at a tag nobody bound has no bed behind it, and a body left untouched
  // is one Node dumps to its end for us.
  const { bound, refused: unbound } = await requireBoundTagForPost(params.tag, request);
  if (unbound) return unbound;
  const { plate, base } = bound;
  const refused = await discardBody(request, 'check-in');
  if (refused) return refused;
  const userId = getSessionUserId(cookies);
  if (!userId) return redirect(`${base}/auth`, 303);

  const store = getStore();
  const view = await getBedView(store, plate);
  if (!view) {
    return await refuseWithBody(request, new Response('No bed with that plate.', { status: 404 }));
  }
  // Being signed in isn't enough: only this bed's guardians can write to its
  // append-only history. Mirrors the gate on mine.astro.
  // Flagged like every other POST route's way back: this render is the tail of
  // a submission, not somebody arriving at the tag.
  if (!view.adopters.some((a) => a.user.id === userId)) {
    return redirect(ourPlaqueLink(base), 303);
  }

  await logPhoto(store, { plate, actorId: userId });
  return redirect(`${base}/mine`, 303);
};
