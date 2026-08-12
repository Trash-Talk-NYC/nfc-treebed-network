// POST: "GIVE THIS WEEK'S PHOTO". Records the weekly photo as an append-only
// event. Image capture/storage and point earning are out of MVP scope
// (task brief) — only the fact of the photo is kept, once per NY week.
import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store-local';
import { getBedView, logPhoto } from '../../../lib/service';
import { getSessionUserId } from '../../../lib/session';
import { discardBody } from '../../../lib/request-body';
import { ourPlaqueLink } from '../../../lib/plaque-url';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const plate = params.plate ?? '';
  const refused = await discardBody(request, 'check-in');
  if (refused) return refused;
  const userId = getSessionUserId(cookies);
  if (!userId) return redirect(`/b/${plate}/auth`, 303);

  const store = getStore();
  const view = await getBedView(store, plate);
  if (!view) return new Response('No bed with that plate.', { status: 404 });
  // Being signed in isn't enough: only this bed's guardians can write to its
  // append-only history. Mirrors the gate on mine.astro.
  // Flagged like every other POST route's way back: this render is the tail of
  // a submission, not somebody arriving at the tag.
  if (!view.adopters.some((a) => a.user.id === userId)) {
    return redirect(ourPlaqueLink(`/b/${plate}`), 303);
  }

  await logPhoto(store, { plate, actorId: userId });
  return redirect(`/b/${plate}/mine`, 303);
};
