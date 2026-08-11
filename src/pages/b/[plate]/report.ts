// POST target of the severity sheet. A plain HTML form POST — the tap
// screen's single most important resilience decision (spec §3a): filing a
// report must work with JavaScript disabled.
import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store-local';
import { RuleError, fileReport } from '../../../lib/service';
import { getActorId } from '../../../lib/session';
import { severityFromIndex } from '../../../lib/severity';

// A phone photo is a few MB; nothing here is stored, so the cap only has to
// leave real reports room. The endpoint is public and unauthenticated, so an
// unbounded body would be a free way to exhaust the server's memory.
const MAX_BODY_BYTES = 12 * 1024 * 1024;

/**
 * Buffer the request body, refusing anything over the cap.
 *
 * Content-Length alone isn't enough — a chunked body doesn't send one, and a
 * declared length is only a claim — so the bytes are counted as they arrive.
 * Returns null when the body is too large.
 */
async function readCappedBody(request: Request, limit: number): Promise<ArrayBuffer | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const plate = params.plate ?? '';
  const base = `/b/${plate}`;
  const actor = getActorId(cookies);

  // A plain HTTP error, not a client-side guard: the form must keep working
  // with JavaScript disabled, so the limit is enforced server-side only.
  const body = await readCappedBody(request, MAX_BODY_BYTES);
  if (!body) {
    return new Response('That photo is too large. Try again with a smaller one.', { status: 413 });
  }

  const form = await new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body,
  }).formData();
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
