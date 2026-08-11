// POST target of the severity sheet. A plain HTML form POST — the tap
// screen's single most important resilience decision (spec §3a): filing a
// report must work with JavaScript disabled.
import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store-local';
import { RuleError, fileReport } from '../../../lib/service';
import { getActorId } from '../../../lib/session';
import { severityFrom, severityFromIndex } from '../../../lib/severity';
import {
  MAX_FORM_BYTES,
  photoAttachedFromHead,
  readCappedHead,
  readFormOrRefuse,
  refusalResponse,
  severityIndexFromHead,
} from '../../../lib/request-body';
import type { Severity } from '../../../lib/types';

// A phone photo is a few MB; nothing here is stored, so the cap only has to
// leave real reports room.
const MAX_PHOTO_BODY_BYTES = 12 * 1024 * 1024;

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const plate = params.plate ?? '';
  const base = `/b/${plate}`;
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
    if (refusal === 'over-limit' || refusal === 'busy') return redirect(tooLarge(base, head, refusal), 303);
    // The body never finished arriving. The too-large screen would blame a
    // photo that may well have been under the cap.
    if (refusal !== null) return refusalResponse(refusal, 'report');
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
      if (err.code === 'open-report-exists') return redirect(base, 303);
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
 * reason is carried too, because "too large" and "too busy" ask for different
 * things from the person holding the phone.
 */
function tooLarge(base: string, head: Uint8Array, refusal: 'over-limit' | 'busy'): string {
  const kept = severityIndexFromHead(head);
  const params = new URLSearchParams();
  if (kept !== null) params.set('severity', String(kept));
  if (refusal === 'busy') params.set('reason', 'busy');
  const query = params.toString();
  return `${base}/too-large${query ? `?${query}` : ''}`;
}
