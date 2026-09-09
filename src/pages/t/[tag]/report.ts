// POST target of the care screen. A plain HTML form POST — the tap screen's
// single most important resilience decision (spec §3a): telling us a bed needs
// care must work with JavaScript disabled.
import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store';
import { RuleError, reportProblem } from '../../../lib/service';
import { getActorId } from '../../../lib/session';
import { noteFrom, problemFrom, type ProblemCategory } from '../../../lib/problem';
import {
  MAX_FORM_BYTES,
  categoryFromHead,
  noteFromHead,
  photoAttachedFromHead,
  readCappedHead,
  readFormOrRefuse,
  type Refusal,
} from '../../../lib/request-body';
import { langLink, readLang, type Lang } from '../../../lib/i18n';
import { BUILD_TARGET } from '../../../lib/build-target';
import { requireBoundTagForPost, postOnly } from '../../../lib/tag-route';

// A phone photo is a few MB; nothing here is stored, so the cap only has to
// leave real reports room — and to stay under whatever the platform in front
// of us refuses first, or the refusal stops being ours.
//
// Netlify caps a synchronous function's request payload at 6MB and buffers
// the body before the function is invoked, so on that target a larger upload
// never reaches this route at all: the platform answers a bare 413 and the
// too-large screen — the whole point of which is handing the visitor back what
// they already told us, without the attachment — never renders. The cap is set
// below that limit there so every refusal a visitor can provoke is one this
// route makes gracefully. The node target keeps the 12MB the streaming bounds
// in request-body.ts are measured against; those bounds are node's sockets
// either way, since Netlify has already buffered the body by the time we read
// it.
const MAX_PHOTO_BODY_BYTES = (BUILD_TARGET === 'netlify' ? 4 : 12) * 1024 * 1024;

export const POST: APIRoute = async ({ params, request, cookies, redirect, url }) => {
  // Resolved before anything else, and its body accounted for either way: a
  // POST at a tag nobody bound has no bed behind it, and a body left untouched
  // is one Node dumps to its end for us.
  const { bound, refused: unbound } = await requireBoundTagForPost(params.tag, request);
  if (unbound) return unbound;
  const { plate, base } = bound;
  const lang = readLang(url, cookies);
  // Filing is the core street action, so this is the one write that mints an
  // identity for a caller who sends no cookie: a confirm the server declines to
  // count costs a visitor nothing they came for, while a report it declines to
  // file is the product. The one-per-person-per-NY-day limit is best-effort for
  // anonymous callers, exactly as the visitor cookie already is (AGENTS.md).
  const actor = getActorId(cookies);

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  let category: ProblemCategory | null = null;
  let note = '';
  let photoAttached = false;

  if (contentType.startsWith('multipart/form-data')) {
    // The photo is read and discarded either way (spec §12), so it is never
    // buffered: the fields that matter are taken off the head instead, which
    // keeps a 12MB upload at kilobytes of heap. Safe because the care screen's
    // markup puts the category and the note ahead of the file input and
    // browsers send parts in DOM order — keep it that way if it gains a field.
    const { head, refusal } = await readCappedHead(request, MAX_PHOTO_BODY_BYTES);
    // Every refusal lands on the same screen, because what the visitor told us
    // is the thing being rescued and the head already holds it whichever way
    // the upload ended. Only the words differ, and an upload that stalled is
    // never told it was too large.
    if (refusal !== null) return redirect(tooLarge(base, head, refusal, lang), 303);
    category = categoryFromHead(head);
    note = noteFromHead(head);
    photoAttached = photoAttachedFromHead(head);
  } else {
    // The too-large screen's one-tap resend: the same choice, no attachment.
    const { form, refused } = await readFormOrRefuse(request, MAX_FORM_BYTES, 'report');
    if (refused) return refused;
    category = problemFrom(form.get('category'));
    note = noteFrom(form.get('note'));
  }

  // Nothing picked. `required` on the tiles is what a browser enforces; this is
  // the server saying the same thing, and it says it on the screen the visitor
  // is already looking at rather than in a status code they cannot act on.
  if (!category) return redirect(langLink(`${base}/care?pick=1`, lang), 303);

  try {
    await reportProblem(getStore(), {
      plate,
      actorId: actor,
      category,
      note,
      photoAttached,
    });
    // One screen after this, whichever of the three happened: the approved flow
    // ends on the thank-you takeover and has no receipt, no confirm screen and
    // no rate-limited screen. What the press was worth is in the record and the
    // events, not in a notice to somebody standing at a tree.
    return redirect(langLink(`${base}/thanks`, lang), 303);
  } catch (err) {
    if (err instanceof RuleError && err.code === 'bed-not-found') {
      return new Response(err.message, { status: 404 });
    }
    throw err;
  }
};

/**
 * Where a refused upload lands. The category and the note are carried across
 * when the head got far enough to hold them, so the screen can offer the whole
 * thing back — and the reason is carried too, because a photo to shrink, a
 * queue to retry and an upload that stopped halfway ask for different things
 * from the person holding the phone. `over-limit` is the screen's default and
 * needs no parameter.
 */
function tooLarge(base: string, head: Uint8Array, refusal: Refusal, lang: Lang): string {
  const kept = categoryFromHead(head);
  const params = new URLSearchParams();
  if (kept !== null) params.set('category', kept);
  const note = noteFromHead(head);
  if (note !== '') params.set('note', note);
  if (refusal === 'busy') params.set('reason', 'busy');
  // Timed out or broken off: both are one upload that never all arrived, and
  // nothing a visitor could act on distinguishes them.
  if (refusal === 'timed-out' || refusal === 'read-failed') params.set('reason', 'incomplete');
  const query = params.toString();
  return langLink(`${base}/too-large${query ? `?${query}` : ''}`, lang);
}

export const ALL = postOnly;
