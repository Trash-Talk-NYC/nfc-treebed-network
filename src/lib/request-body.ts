// Reading a request body without trusting it.
//
// The report endpoint is public and unauthenticated, so an unbounded body is a
// free way to exhaust the server's memory. This is transport-level handling,
// not a rule — it knows nothing about beds, and the rules in service.ts know
// nothing about it.

import { severityIndexFrom } from './severity';

export interface CappedBody {
  /** The whole body, or null when it exceeded the cap. */
  body: ArrayBuffer | null;
  /** The leading bytes, kept even when the body is refused. */
  head: Uint8Array;
}

/**
 * How much of the head to keep. A browser sends a form's small text fields in
 * DOM order, ahead of the file part, so the head of an oversized upload still
 * carries the fields that came before it.
 */
export const HEAD_BYTES = 8 * 1024;

/**
 * Buffer the request body, refusing anything over `limit`.
 *
 * Content-Length alone isn't enough — a chunked body doesn't send one, and a
 * declared length is only a claim — so the bytes are counted as they arrive.
 * Once the body is known to be too large, reading stops as soon as the head is
 * in hand; the rest of the upload is never buffered.
 */
export async function readCappedBody(request: Request, limit: number): Promise<CappedBody> {
  const declared = Number(request.headers.get('content-length'));
  let over = Number.isFinite(declared) && declared > limit;
  if (!request.body) {
    return { body: over ? null : new ArrayBuffer(0), head: new Uint8Array() };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total > limit) over = true;
    if (over && total >= HEAD_BYTES) {
      await reader.cancel();
      break;
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    body: over ? null : (merged.buffer as ArrayBuffer),
    head: merged.subarray(0, HEAD_BYTES),
  };
}

/**
 * The severity index out of a multipart body's head, or null if it isn't in
 * there. A truncated body can't go through formData(), so the one field worth
 * rescuing from a refused upload is read off the part that precedes the file.
 */
export function severityIndexFromHead(head: Uint8Array): number | null {
  const text = Buffer.from(head).toString('latin1');
  const match = /name="severity"[^]*?\r?\n\r?\n([^\r\n]*)/.exec(text);
  return match ? severityIndexFrom(match[1]) : null;
}
