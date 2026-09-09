// POST: "I CLEANED IT — CLOSE THE REPORT". The guardian view's button, and
// only that: the route is gated on a signed-in adopter of this bed.
//
// Spec §2 says anyone can mark clear, and `closeReport` still can — the rule
// is untouched, the gate is here. Closing a report is what lets the next one be
// filed, so an ungated `/clear` completes `report → clear → report`, a loop
// with no UI behind it that appends a `Report` and two `BedEvent`s per lap to a
// history nothing prunes, each written by re-serializing the whole file. A
// cookie gate only priced that at one GET. Re-opening anonymous clear needs a
// storage bound first (a per-bed daily cap on anonymous clears is the shape) —
// see AGENTS.md; it is not a matter of deleting these two checks.
import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store';
import { RuleError, closeReport, getBedView } from '../../../lib/service';
import { getSessionUserId } from '../../../lib/session';
import { discardBody } from '../../../lib/request-body';
import { ourPlaqueLink } from '../../../lib/plaque-url';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const plate = params.plate ?? '';
  const refused = await discardBody(request, 'update');
  if (refused) return refused;
  const userId = getSessionUserId(cookies);
  // The guardian's own view logs no tap; the plaque does, so the way back for
  // anyone else carries the flag that says this render is our redirect.
  const plaque = ourPlaqueLink(`/b/${plate}`);
  if (!userId) return redirect(plaque, 303);

  const store = getStore();
  const view = await getBedView(store, plate);
  if (!view) return new Response('No bed with that plate.', { status: 404 });
  if (!view.adopters.some((a) => a.user.id === userId)) return redirect(plaque, 303);

  const back = `/b/${plate}/mine`;
  try {
    await closeReport(store, { plate, actorId: userId });
    return redirect(back, 303);
  } catch (err) {
    if (err instanceof RuleError && err.code === 'no-open-report') return redirect(back, 303);
    throw err;
  }
};
