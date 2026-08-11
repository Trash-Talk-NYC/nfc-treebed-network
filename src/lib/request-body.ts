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

/** Cap for the text-only forms (sign in, adopt): short fields, nothing else. */
export const MAX_FORM_BYTES = 64 * 1024;

/**
 * How far past the cap a refused body is still read to its end. Draining is
 * what lets the response reach the client (see below), but it must not be an
 * open invitation: past this the connection is dropped, and a client streaming
 * that much after being refused is not a phone with a big photo.
 */
const DRAIN_CEILING = 8;

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * Buffer the request body, refusing anything over `limit`.
 *
 * Content-Length alone isn't enough — a chunked body doesn't send one, and a
 * declared length is only a claim — so the bytes are counted as they arrive.
 * Once the body is known to be too large, nothing past the head is kept: the
 * rest is read and discarded, so memory stays bounded at the head plus one
 * chunk.
 *
 * Discarding rather than cancelling is the whole point. Cancelling the reader
 * destroys the underlying socket, and the client — still uploading — gets a
 * connection reset instead of the response we wrote for it. Reading to the end
 * costs bandwidth we were going to receive anyway and leaves a live socket to
 * answer on.
 */
export async function readCappedBody(request: Request, limit: number): Promise<CappedBody> {
  const declared = Number(request.headers.get('content-length'));
  let over = Number.isFinite(declared) && declared > limit;
  if (!request.body) {
    return { body: over ? null : new ArrayBuffer(0), head: new Uint8Array() };
  }

  const reader = request.body.getReader();
  const headChunks: Uint8Array[] = [];
  let headBytes = 0;
  // Dropped the moment the body is refused — the refused bytes are never held.
  let kept: Uint8Array[] | null = over ? null : [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (headBytes < HEAD_BYTES) {
        // Copied, not sliced: a view would pin this whole chunk in memory.
        const head = value.slice(0, HEAD_BYTES - headBytes);
        headChunks.push(head);
        headBytes += head.byteLength;
      }
      if (!over && total > limit) over = true;
      if (over) {
        kept = null;
        if (total > limit * DRAIN_CEILING) {
          await reader.cancel();
          break;
        }
        continue;
      }
      kept!.push(value);
    }
  } catch {
    // The platform's own body limit, or a client that hung up mid-upload.
    // Either way there is no complete body to hand back.
    over = true;
    kept = null;
  }

  const head = concat(headChunks, headBytes);
  if (over || !kept) return { body: null, head };
  return { body: concat(kept, total).buffer as ArrayBuffer, head };
}

/** Parse a body already read and accepted by `readCappedBody`. */
export function formDataFrom(request: Request, body: ArrayBuffer): Promise<FormData> {
  return new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body,
  }).formData();
}

/**
 * A capped body parsed as form fields, or null when it was refused. For the
 * text-only forms, where an oversized body has nothing worth rescuing.
 */
export async function readCappedForm(request: Request, limit: number): Promise<FormData | null> {
  const { body } = await readCappedBody(request, limit);
  return body === null ? null : formDataFrom(request, body);
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
