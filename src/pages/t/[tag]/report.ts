// POST target of the severity sheet. A plain HTML form POST — the tap
// screen's single most important resilience decision (spec §3a): filing a
// report must work with JavaScript disabled.
import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store';
import { RuleError, fileReport } from '../../../lib/service';
import { getActorId } from '../../../lib/session';
import { severityFrom, severityFromIndex } from '../../../lib/severity';
import {
  MAX_FORM_BYTES,
  photoAttachedFromHead,
  readCappedHead,
  readFormOrRefuse,
  severityIndexFromHead,
  type Refusal,
} from '../../../lib/request-body';
import { ourPlaqueLink } from '../../../lib/plaque-url';
import { BUILD_TARGET } from '../../../lib/build-target';
import { requireBoundTagForPost } from '../../../lib/tag-route';
import type { Severity } from '../../../lib/types';

// A phone photo is a few MB; nothing here is stored, so the cap only has to
// leave real reports room — and to stay under whatever the platform in front
// of us refuses first, or the refusal stops being ours.
//
// Netlify caps a synchronous function's request payload at 6MB and buffers
// the body before the function is invoked, so on that target a larger upload
// never reaches this route at all: the platform answers a bare 413 and the
// too-large screen — the whole point of which is handing the visitor back the
// report they already filled in, without the attachment — never renders. The
// cap is set below that limit there so every refusal a visitor can provoke is
// one this route makes gracefully. The node target keeps the 12MB the
// streaming bounds in request-body.ts are measured against; those bounds are
// node's sockets either way, since Netlify has already buffered the body by
// the time we read it.
const MAX_PHOTO_BODY_BYTES = (BUILD_TARGET === 'netlify' ? 4 : 12) * 1024 * 1024;

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  // Resolved before anything else, and its body accounted for either way: a
  // POST at a tag nobody bound has no bed behind it, and a body left untouched
  // is one Node dumps to its end for us.
  const { bound, refused: unbound } = await requireBoundTagForPost(params.tag, request);
  if (unbound) return unbound;
  const { plate, base } = bound;
  const actor = getActorId(cookies);

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  let severity: Severity | null = null;
  let photoAttached = false;

  if (contentType.startsWith('multipart/form-data')) {
    // The photo is read and discarded either way (spec §12), so it is never
    // buffered: the two fields that matter are taken off the head instead,
    // which keeps a 12MB upload at kilobytes of heap. Safe because the sheet's
    // markup puts the severity input ahead of the file input and browsers send
    // parts in DOM order — keep it that way if the sheet ever gains a field.
    // Enforced server-side only — the form must keep working with JavaScript
    // disabled — and an oversized photo never costs the visitor the report
    // they already filled in: the severity they picked rides the redirect to a
    // screen that offers to file it without the attachment.
    const { head, refusal } = await readCappedHead(request, MAX_PHOTO_BODY_BYTES);
    // Every refusal lands on the same screen, because the report is the thing
    // being rescued and the head already holds the severity whichever way the
    // upload ended. Only the words differ, and an upload that stalled is never
    // told it was too large — a body under the cap that never finished sends
    // somebody off to shrink a photo that was fine.
    if (refusal !== null) return redirect(tooLarge(base, head, refusal), 303);
    const index = severityIndexFromHead(head);
    severity = index === null ? null : severityFromIndex(index);
    photoAttached = photoAttachedFromHead(head);
  } else {
    // The too-large screen's one-tap refile: the same report, no attachment.
    const { form, refused } = await readFormOrRefuse(request, MAX_FORM_BYTES, 'report');
    if (refused) return refused;
    severity = severityFrom(form.get('severity'));
  }

  if (!severity) return new Response('Severity must be 0, 1, or 2.', { status: 400 });

  try {
    const report = await fileReport(getStore(), { plate, actorId: actor, severity, photoAttached });
    return redirect(`${base}/receipt/${report.id}`, 303);
  } catch (err) {
    if (err instanceof RuleError) {
      // Someone else's report is already open → confirm/escalate screen.
      if (err.code === 'open-report-exists') return redirect(ourPlaqueLink(base), 303);
      // Their own daily limit → the rate-limited screen.
      if (err.code === 'already-reported-today') return redirect(`${base}?limited=1`, 303);
      if (err.code === 'bed-not-found') return new Response(err.message, { status: 404 });
    }
    throw err;
  }
};

/**
 * Where a refused upload lands. The severity is carried across when the head
 * got far enough to hold it, so the screen can offer the report back — and the
 * reason is carried too, because a photo to shrink, a queue to retry and an
 * upload that stopped halfway ask for different things from the person holding
 * the phone. `over-limit` is the screen's default and needs no parameter.
 */
function tooLarge(base: string, head: Uint8Array, refusal: Refusal): string {
  const kept = severityIndexFromHead(head);
  const params = new URLSearchParams();
  if (kept !== null) params.set('severity', String(kept));
  if (refusal === 'busy') params.set('reason', 'busy');
  // Timed out or broken off: both are one upload that never all arrived, and
  // nothing a visitor could act on distinguishes them.
  if (refusal === 'timed-out' || refusal === 'read-failed') params.set('reason', 'incomplete');
  const query = params.toString();
  return `${base}/too-large${query ? `?${query}` : ''}`;
}
