// POST target of the severity sheet. A plain HTML form POST — the tap
// screen's single most important resilience decision (spec §3a): filing a
// report must work with JavaScript disabled.
import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store-local';
import { RuleError, fileReport } from '../../../lib/service';
import { getActorId } from '../../../lib/session';
import { severityFromIndex } from '../../../lib/severity';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const plate = params.plate ?? '';
  const base = `/b/${plate}`;
  const actor = getActorId(cookies);

  const form = await request.formData();
  const severity = severityFromIndex(Number(form.get('severity')));
  if (!severity) return new Response('Severity must be 0, 1, or 2.', { status: 400 });

  // The optional photo: only the fact of attachment is recorded. Storing the
  // image is out of MVP scope (spec §12) — bytes are read and discarded here.
  const photo = form.get('photo');
  const photoAttached = photo instanceof File && photo.size > 0;

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
