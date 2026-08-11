// POST: "GIVE THIS WEEK'S PHOTO". Records the weekly photo as an append-only
// event. Image capture/storage and point earning are out of MVP scope
// (task brief) — only the fact of the photo is kept, once per NY week.
import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store-local';
import { hasPhotoThisWeek, logPhoto } from '../../../lib/service';
import { getSessionUserId } from '../../../lib/session';

export const POST: APIRoute = async ({ params, cookies, redirect }) => {
  const plate = params.plate ?? '';
  const userId = getSessionUserId(cookies);
  if (!userId) return redirect(`/b/${plate}/auth`, 303);
  const store = getStore();
  if (!(await hasPhotoThisWeek(store, plate, userId))) {
    await logPhoto(store, { plate, actorId: userId });
  }
  return redirect(`/b/${plate}/mine`, 303);
};
