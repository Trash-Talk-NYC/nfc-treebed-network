// Reading a request body without trusting it.
//
// The report endpoint is public and unauthenticated, so an unbounded body is a
// free way to exhaust the server's memory. This is transport-level handling,
// not a rule — it knows nothing about beds, and the rules in service.ts know
// nothing about it.

import { severityIndexFrom } from './severity';

/**
 * Why a body was refused. A body that never arrived is not a body that was
 * too big: telling a visitor "that photo was too large" about a stream that
 * failed sends them to fix the wrong thing.
 */
export type Refusal = 'over-limit' | 'read-failed';

/**
 * A body, or the reason there isn't one — never both, and never neither.
 * `head` is the leading bytes, kept even when the body is refused.
 */
export type CappedBody =
  | { body: ArrayBuffer; head: Uint8Array; refusal: null }
  | { body: null; head: Uint8Array; refusal: 'over-limit' }
  | { body: null; head: Uint8Array; refusal: 'read-failed' };

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
 * open invitation, and the budget has to be an absolute number of bytes: as a
 * multiple of the cap it would have meant half a megabyte on the text forms
 * and ninety-six on the report route, which is the one anyone with the tag URL
 * can post to. 24MB of headroom covers the 12–30MB a real phone photo lands
 * in; a body still streaming past that is not somebody's photo.
 */
export const DRAIN_HEADROOM_BYTES = 24 * 1024 * 1024;

/**
 * How long draining a refused body may take in total. Bytes alone don't bound
 * a slow sender — a trickle holds the read open until Node's own 300s request
 * timeout, for a request already refused. Well under that backstop, and well
 * over the ~160s a 20MB photo takes on a bad uplink: the point is to bound the
 * drain, not to cut off the visitor this screen exists for.
 */
export const DRAIN_TIMEOUT_MS = 180_000;

/**
 * How long a refused body may go without sending anything. A sender that has
 * gone quiet is finished or gone, whatever its total budget still says.
 */
export const DRAIN_IDLE_MS = 15_000;

/** What a refused body may still cost before the connection is dropped. */
export interface DrainBounds {
  /** Extra bytes past the cap it may still stream. */
  drainHeadroom?: number;
  /** How long that may take in total. */
  drainTimeoutMs?: number;
  /** How long it may go without sending anything. */
  drainIdleMs?: number;
}

/** The read stalled past the drain deadline. */
const STALLED = Symbol('stalled');

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

async function readWithin(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
): Promise<ReadableStreamReadResult<Uint8Array> | typeof STALLED> {
  const read = reader.read();
  // The loser of the race is still a live promise; without this its failure
  // would surface as an unhandled rejection after we have moved on.
  read.catch(() => {});
  let timer: NodeJS.Timeout | undefined;
  const stall = new Promise<typeof STALLED>((resolve) => {
    timer = setTimeout(() => resolve(STALLED), ms);
  });
  try {
    return await Promise.race([read, stall]);
  } finally {
    clearTimeout(timer);
  }
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
 * answer on. That courtesy has bounds — `drainHeadroom` bytes, `drainIdleMs`
 * of silence, `drainTimeoutMs` in all — and past any of them this stops
 * reading, which lets the platform close the connection on a body it never
 * finished. Whatever is on the other end of that one is not a visitor waiting
 * for a screen.
 */
export async function readCappedBody(
  request: Request,
  limit: number,
  {
    drainHeadroom = DRAIN_HEADROOM_BYTES,
    drainTimeoutMs = DRAIN_TIMEOUT_MS,
    drainIdleMs = DRAIN_IDLE_MS,
  }: DrainBounds = {},
): Promise<CappedBody> {
  const declared = Number(request.headers.get('content-length'));
  let over = Number.isFinite(declared) && declared > limit;
  if (!request.body) {
    const head = new Uint8Array();
    return over
      ? { body: null, head, refusal: 'over-limit' }
      : { body: new ArrayBuffer(0), head, refusal: null };
  }

  const reader = request.body.getReader();
  const headChunks: Uint8Array[] = [];
  let headBytes = 0;
  // Dropped the moment the body is refused — the refused bytes are never held.
  let kept: Uint8Array[] | null = over ? null : [];
  let total = 0;
  let failed = false;
  // Starts when the body is refused: only the drain is on a clock, an
  // accepted body is as slow as the network makes it.
  let drainDeadline = over ? Date.now() + drainTimeoutMs : 0;

  // Past a bound the drain simply stops here, without cancelling: cancelling
  // leaves the response unwritten and the socket idling until Node's request
  // timeout, while walking away lets the route answer and lets Node close the
  // connection behind a response whose request body was never finished.
  try {
    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;
      if (over) {
        const remaining = drainDeadline - Date.now();
        if (remaining <= 0) break;
        // Whichever bound comes first: gone quiet, or out of total time.
        const raced = await readWithin(reader, Math.min(remaining, drainIdleMs));
        if (raced === STALLED) break;
        result = raced;
      } else {
        result = await reader.read();
      }
      if (result.done) break;
      const value = result.value;
      total += value.byteLength;
      if (headBytes < HEAD_BYTES) {
        // Copied, not sliced: a view would pin this whole chunk in memory.
        const head = value.slice(0, HEAD_BYTES - headBytes);
        headChunks.push(head);
        headBytes += head.byteLength;
      }
      if (!over && total > limit) {
        over = true;
        drainDeadline = Date.now() + drainTimeoutMs;
      }
      if (over) {
        kept = null;
        if (total > limit + drainHeadroom) break;
        continue;
      }
      kept!.push(value);
    }
  } catch (err) {
    // Not an oversized body: the platform's own limit tripping, a stream
    // error, or a client that hung up mid-upload. It reaches nobody's screen,
    // so the log is the only place it can be found.
    console.error(
      `[request-body] read failed for ${request.method} ${new URL(request.url).pathname}:`,
      err,
    );
    failed = true;
    kept = null;
  }

  const head = concat(headChunks, headBytes);
  if (failed) return { body: null, head, refusal: 'read-failed' };
  if (over || !kept) return { body: null, head, refusal: 'over-limit' };
  return { body: concat(kept, total).buffer as ArrayBuffer, head, refusal: null };
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
 * One member per refusal rather than `refusal: Refusal`: a discriminant only
 * narrows a destructured result when each member gives it a single value, and
 * the routes read `form` right after checking `refusal`.
 */
export type CappedForm =
  | { form: FormData; refusal: null }
  | { form: null; refusal: 'over-limit' }
  | { form: null; refusal: 'read-failed' };

/**
 * A capped body parsed as form fields, for the text-only forms — where an
 * oversized body has nothing worth rescuing.
 *
 * These carry a handful of short fields, so the drain budget is the cap
 * itself: no legitimate sign-in overshoots 64KB by megabytes, and the
 * photo-sized headroom the report route needs would only be an abuse budget
 * here.
 */
export async function readCappedForm(request: Request, limit: number): Promise<CappedForm> {
  const { body, refusal } = await readCappedBody(request, limit, { drainHeadroom: limit });
  if (body === null) return { form: null, refusal };
  return { form: await formDataFrom(request, body), refusal: null };
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
