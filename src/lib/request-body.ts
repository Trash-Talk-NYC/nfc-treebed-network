// Reading a request body without trusting it.
//
// Every route here is public and unauthenticated — the plaque URL is printed
// on a sidewalk tag — so an unbounded body, an unbounded read, or an unbounded
// number of them at once is a free way to exhaust the server. This is
// transport-level handling, not a rule: it knows nothing about beds, and the
// rules in service.ts know nothing about it.
//
// What bounds every publicly reachable route. "Screen" below means a styled
// page; no bound is ever enforced by dropping the connection on a visitor.
//
//   GET  /                             A redirect to the first live tag, built
//                                      by ourPlaqueLink; no body, no buffer,
//                                      and no store read at all.
//   GET  /t/<tag>                      No body to read, so no size, time or
//                                      concurrency bound applies. Peak heap is
//                                      one render's reads, no per-request
//                                      buffer. A failed tap write is logged and
//                                      the plaque still renders.
//   GET  .../care, adopt, auth,        Same: no body, no buffer.
//        thanks, adopted, too-large
//   GET  .../mine                      Same, behind a session check.
//   Any method at those screens        Astro renders a page for a POST as
//                                      readily as for a tap, and none of these
//                                      has a form behind it — so the body is
//                                      not read but not left either:
//                                      `abandonBody` takes SHED_DRAIN_BYTES /
//                                      SHED_DRAIN_MS of it and stops, on the
//                                      same MAX_SHED_READS accounting as the
//                                      row below. Leaving it untouched is what
//                                      would be unbounded, not the other way
//                                      round.
//   POST .../report  (multipart)       Size: 12MB on the node target, 4MB on
//                                      netlify (report.ts explains why),
//                                      counted as bytes arrive
//                                      (`readCappedHead`); nothing past the 8KB
//                                      head is ever held, so a 12MB photo costs
//                                      no copies of itself. Time: HEAD_READ_*
//                                      until the head is in, READ_* after that
//                                      while the body may still be filed,
//                                      DRAIN_* once it is refused, and never
//                                      past READ_TIMEOUT_MS from the start any
//                                      of those ways. Concurrency: HEAD_BYTES +
//                                      CHUNK_ALLOWANCE_BYTES reserved out of
//                                      MAX_INFLIGHT_BODY_BYTES, or one of
//                                      MAX_SHED_READS slots if there is no room.
//                                      Peak heap: the head plus the chunk in
//                                      hand, which is exactly what it reserves.
//                                      Every refusal → the too-large screen,
//                                      severity preserved — except past
//                                      MAX_SHED_READS, where the read keeps
//                                      nothing and stops at SHED_DRAIN_BYTES /
//                                      SHED_DRAIN_MS, so the busy screen goes
//                                      out without the severity.
//   POST .../report  (refile, no file) Size: MAX_FORM_BYTES buffered. Time and
//                                      concurrency as below. Peak heap ~128KB.
//                                      Refused → a plain short answer: this
//                                      body is one field, so only a broken
//                                      connection ever gets there, and the
//                                      screen it would go back to is the one it
//                                      was just sent from.
//   POST .../auth, .../adopt           Size: MAX_FORM_BYTES buffered. Time:
//                                      FORM_READ_TIMEOUT_MS / _IDLE_MS, on the
//                                      drain as well — a body that can only be
//                                      five short fields gets seconds, not the
//                                      minutes a photo needs. Concurrency: 2×
//                                      that cap + CHUNK_ALLOWANCE_BYTES reserved
//                                      out of MAX_INFLIGHT_BODY_BYTES, which is
//                                      the peak heap too (the chunks, the merged
//                                      copy, the chunk in hand). Refused → a
//                                      plain short answer, the same shape these
//                                      forms already give a rejected field.
//   POST .../applause                  One button, so `discardBody` reads the
//                                      body to its end under MAX_FORM_BYTES and
//                                      keeps nothing: the same short time
//                                      bounds, the head-only reservation, same
//                                      peak. Refused → a plain short answer.
//                                      Leaving it unread would cost heap nothing
//                                      and could cost the caller this route's
//                                      redirect.
//   POST .../clear, .../photo          The same, behind session and steward
//                                      checks — the body is read on the same
//                                      bounds before either is consulted, so an
//                                      unauthenticated POST is bounded by the
//                                      row above and writes nothing.
//   POST at an unbound/invalid tag     Answered 404 before any rule runs, so
//                                      nothing above it applies — but the body
//                                      still does: `abandonBody` takes
//                                      SHED_DRAIN_BYTES / SHED_DRAIN_MS of it
//                                      and stops, keeping nothing beyond the
//                                      chunk in hand and counting that against
//                                      MAX_SHED_READS like any other refusal.
//                                      Leaving it unread is the expensive
//                                      answer, not the free one (see
//                                      SHED_DRAIN_BYTES below).
//   Any other method, any route        A route bounds only the method it
//                                      exports; Astro answers the rest itself,
//                                      body untouched. The four POST routes
//                                      (report, applause, clear, photo) export
//                                      `ALL` (`postOnly`, tag-route.ts)
//                                      so that answer is a 405 rather than a
//                                      404 with a log line per request, and
//                                      src/middleware.ts drains once after the
//                                      response is decided — the backstop for
//                                      every route and every method at once,
//                                      and a no-op wherever the body was
//                                      already read.
//
// The time bounds split because the reservation is only released when one of
// them fires, so the slowest body a route can receive is what decides how long
// its share of MAX_INFLIGHT_BODY_BYTES can be held: minutes on the report
// route, which really does receive 12MB over a bad uplink, and seconds
// everywhere else, where a body that takes minutes is a trickle holding a slot
// rather than anything a person sent. The report route earns its minutes only
// once it has shown a photo: every read, that one included, is on the short
// HEAD_READ_* clocks until the first HEAD_BYTES are in — a phone puts those on
// the wire in well under a second, and until they arrive nothing distinguishes
// a 12MB upload from a socket dribbling a byte at a time to hold a slot.
//
// Two counters carry the concurrency column: MAX_INFLIGHT_BODY_BYTES for reads
// that were admitted, MAX_SHED_READS for the ones being turned away, which hold
// a head and a chunk of their own while they shed. Their sum — about 52MB — is
// what this file holds for every read it is keeping anything for. Past
// MAX_SHED_READS a read keeps nothing at all: no reservation, no head, and a
// drain of one chunk, which is the same order as the socket buffer Node holds
// for that connection whatever we do. What it costs at that depth is ingress,
// and SHED_DRAIN_BYTES/SHED_DRAIN_MS is that bound — measured, because leaving
// the body untouched instead does not avoid the cost: Node dumps the body of
// any request whose response finished unread, which reads the whole thing.

// Every counter here — and MAX_INFLIGHT_PIN_HASHES in service.ts — is module
// state, so it bounds one process. That is the whole server on the node target,
// which is what `npm start` runs and what the e2e suite measures. On the netlify
// target it is one function instance: the fleet's peak heap and bcrypt
// concurrency are these numbers multiplied by however many instances the
// platform has running, and a single warm instance serving concurrent
// invocations sheds legitimate sign-ins at MAX_INFLIGHT_PIN_HASHES the same as
// a flood. These are per-instance costs, not the pilot's surface-wide ceiling;
// bounding the surface is per-IP limiting at the platform tier.

// One refusal on this surface is not ours, deliberately. Astro's own
// cross-origin guard is unshifted ahead of src/middleware.ts and answers a POST
// carrying a form-like content-type with a missing or mismatched `Origin` header
// 403 before any app code runs — body unread, so Node dumps it, and nothing
// above applies. Owning it would mean `security: { checkOrigin: false }` in
// astro.config.mjs plus the same CSRF check re-implemented in our middleware
// behind a bounded drain: taking a real security control the framework already
// does correctly onto ourselves, to recover effort spent on requests that were
// going to be refused anyway. Nothing here risks data — the residue is server
// work on forged requests — so this is accepted rather than fixed. It is one
// config line to revisit if that ever stops being the right trade.

// What this sweep does NOT bound is CPU. A body admitted here is free to serve
// until a rule turns it into work, and on /auth and /adopt that work is a
// bcrypt — bounded separately by MAX_INFLIGHT_PIN_HASHES in service.ts, where
// the rule that spends it lives.

import { boundFromEnv } from './bounds';
import { noteFrom, problemFrom, type ProblemCategory } from './problem';

/**
 * Why a body was refused.
 *
 * Separate values because the remedies differ: a body that never arrived is
 * not a body that was too big, and neither is one the server had no room for.
 * Telling a visitor "that photo was too large" about a stream that failed
 * sends them to fix the wrong thing.
 */
export type Refusal = 'over-limit' | 'read-failed' | 'timed-out' | 'busy';

/** A body, or the reason there isn't one. `head` survives either way. */
export type CappedBody =
  | { body: ArrayBuffer; head: Uint8Array; refusal: null }
  | { body: null; head: Uint8Array; refusal: Refusal };

/** A body's leading bytes, for a route that wants nothing else. */
export interface CappedHead {
  head: Uint8Array;
  /** Bytes that arrived, however few were kept. */
  bytes: number;
  refusal: Refusal | null;
}

/**
 * How much of the head to keep. A browser sends a form's small text fields in
 * DOM order, ahead of the file part, so the head of an upload carries the
 * fields that came before it — which is all the report route wants.
 */
export const HEAD_BYTES = 8 * 1024;

/** Cap for the text-only forms (sign in, adopt, refile): short fields only. */
export const MAX_FORM_BYTES = 64 * 1024;

/**
 * What a read is holding on top of whatever it keeps: Node's HTTP reader hands
 * a body up in chunks of about this size, and one of them is in hand while the
 * loop decides what to do with it. Small next to a buffered body and eight
 * times the head of a head-only read, which is why leaving it out of the
 * reservation below under-counted the report route by an order of magnitude.
 */
export const CHUNK_ALLOWANCE_BYTES = 64 * 1024;

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
 *
 * This is a budget for the drain, not an extension of the request: a body that
 * crosses the cap late would otherwise run `time-until-over + 180s`, which on a
 * slow uplink lands past the 300s backstop and hands the visitor the very
 * connection reset the drain exists to avoid. So the drain deadline is clamped
 * to `READ_TIMEOUT_MS` from the start of the read, and that is the ceiling on
 * a request's whole lifetime here whichever way it ends.
 */
export const DRAIN_TIMEOUT_MS = 180_000;

/**
 * How long a refused body may go without sending anything. A sender that has
 * gone quiet is finished or gone, whatever its total budget still says.
 */
export const DRAIN_IDLE_MS = 15_000;

/**
 * How long reading a body the server would still accept may take in total.
 * A refused body was already on a clock; an accepted one needs the same bound
 * for the same reason — an 11.9MB upload trickling in holds a request open,
 * and "under the cap" is not a licence to take forever. Under Node's own 300s
 * request timeout so this is the bound that fires, and far over the ~100s a
 * 12MB photo takes on a slow phone uplink.
 */
export const READ_TIMEOUT_MS = 240_000;

/** How long such a body may go without sending anything. */
export const READ_IDLE_MS = 30_000;

/**
 * The same two bounds for a body that can only be short: one button, or five
 * text fields somebody typed with their thumbs.
 *
 * The photo-sized bounds above are what a 12MB upload needs on a bad sidewalk
 * uplink, and inheriting them here was what let a trickle deny the whole
 * server: a cookie-less client sending one byte every 25s holds each read for
 * four minutes while its reservation sits inside `MAX_INFLIGHT_BODY_BYTES`, so
 * a few hundred sockets at ~40 bytes/sec together exhaust the budget and every
 * public POST answers `busy` until they time out. Heap stayed bounded, which is
 * what that budget was built for; availability did not, because the bound that
 * releases a reservation was sized for a body a thousand times larger than
 * anything these routes can receive.
 *
 * Generous for what they carry — a sign-in on a bad connection is kilobytes —
 * and they bound the drain too, so a refused short body can't outlast them
 * either.
 */
export const FORM_READ_TIMEOUT_MS = 10_000;

/** And how long one of those may go without sending anything. */
export const FORM_READ_IDLE_MS = 5_000;

/**
 * The same two bounds again, for the part of *any* body that precedes the
 * first `HEAD_BYTES` — the phase every read starts in.
 *
 * The photo clocks belong to a photo, and until the head is full nothing has
 * arrived that could be one: a report with no attachment is a few hundred
 * bytes in total, and a real phone puts the first chunk of a 20MB upload on the
 * wire in well under a second even on a bad sidewalk uplink. Giving that phase
 * four minutes made `/report` the cheapest way to hold a reservation inside
 * `MAX_INFLIGHT_BODY_BYTES` — one byte every 29s from a few hundred cookie-less
 * sockets, ~30 bytes/sec in all, and every public POST answers `busy` until
 * they time out. It is the same denial the short form clocks above closed,
 * which is why the head gets the same answer wherever it is being read.
 *
 * Past the head the long clocks take over, because from there the body really
 * may be 12MB arriving slowly, and that case must stay graceful.
 */
export const HEAD_READ_TIMEOUT_MS = FORM_READ_TIMEOUT_MS;

/** And how long a body may go without sending anything before its head is in. */
export const HEAD_READ_IDLE_MS = FORM_READ_IDLE_MS;

/**
 * How many bytes all in-flight reads together may be holding.
 *
 * A per-request cap bounds one request; nothing bounded how many arrive at
 * once. Each read reserves what it can hold at its peak — see `reservation`
 * below, which counts the chunk in hand as well as the bytes kept — before it
 * starts, and releases it when it finishes. It caps concurrency in the unit
 * that matters: hundreds of head-only uploads fit, while a route that buffers
 * megabytes gets only a handful.
 *
 * A read that doesn't fit is refused as 'busy', on `BUSY_DRAIN_BYTES` rather
 * than the drain headroom: a refusal that costs as much ingress as an admitted
 * upload sheds nothing, which is the opposite of what a capacity bound is for.
 *
 * This budget covers admitted reads only. A shed read — and an abandoned body,
 * which holds a chunk and nothing else — still holds something while it sheds,
 * so `MAX_SHED_READS` bounds those separately, and every read that keeps
 * anything at all is inside the two together:
 * `MAX_INFLIGHT_BODY_BYTES + MAX_SHED_READS × (HEAD_BYTES +
 * CHUNK_ALLOWANCE_BYTES)`, about 52MB. Past the shed count a read keeps
 * nothing, and what bounds it is `SHED_DRAIN_BYTES`/`SHED_DRAIN_MS` of ingress
 * rather than a share of this.
 */
export const MAX_INFLIGHT_BODY_BYTES = boundFromEnv(
  'TREEBED_MAX_INFLIGHT_BODY_BYTES',
  48 * 1024 * 1024,
);

/**
 * How many reads the server had no room for may be shedding at once.
 *
 * The budget above is what admitted reads may hold; without a bound of its own
 * the refusal path sits outside it, and a deep enough spike costs more in
 * heads-and-chunks for bodies being turned away than the budget allows for the
 * ones being served. Sized so the shed path's whole share — 64 × (8KB head +
 * 64KB chunk in hand) ≈ 4.5MB — stays small next to the 48MB above.
 *
 * Past this many, the read keeps nothing: no reservation, no head, and the
 * drain below in place of the busy budget. That costs the report route its
 * severity preservation, since the severity is read off the head — an
 * acceptable loss at the depth of spike it takes to get here, where the visitor
 * still gets the busy screen and a retry.
 */
export const MAX_SHED_READS = boundFromEnv('TREEBED_MAX_SHED_READS', 64);

/**
 * How far a read past `MAX_SHED_READS` is drained before it is answered.
 *
 * Not reading the body at all would be cheaper still, and it is not on offer:
 * Node dumps the body of any request whose response finished without it being
 * consumed, which resumes the socket and reads the body to its end — a full
 * 200MB for one refused POST when measured, bounded by nothing but Node's own
 * 300s request timeout. Taking the first chunk ourselves is what marks the body
 * consumed, and from there the read stops where this says rather than where the
 * sender does. The connection stays live either way, so the busy screen still
 * reaches the person holding the phone (`tests/report-upload.e2e.test.ts`).
 */
export const SHED_DRAIN_BYTES = CHUNK_ALLOWANCE_BYTES;

/** And for no longer than this, for a sender that has gone quiet. */
export const SHED_DRAIN_MS = 1_000;

/**
 * How far a read the server had no room for is drained.
 *
 * The headroom above exists so a visitor's photo can finish arriving and be
 * answered with a screen. That reasoning does not survive being at capacity:
 * the whole point of refusing is to stop spending on this request, and 36MB of
 * ingress per refusal is the same bill an admitted upload runs up. Every body
 * that carries something a person typed — a sign-in, an adopt form, a refile,
 * a single-button POST — is far under this and still gets its answer intact.
 * A multi-megabyte photo arriving while the server is already full is the one
 * case that loses its screen: the read stops and the connection closes behind
 * it, which at that point is the correct answer rather than a courtesy owed.
 */
export const BUSY_DRAIN_BYTES = 256 * 1024;

/** And for no longer than this, for the same reason. */
export const BUSY_DRAIN_MS = 5_000;

/** What a body may cost before the read gives up on it. */
export interface ReadBounds {
  /** Extra bytes past the cap a refused body may still stream. */
  drainHeadroom?: number;
  /** How long draining a refused body may take in total. */
  drainTimeoutMs?: number;
  /** How long a refused body may go without sending anything. */
  drainIdleMs?: number;
  /** How long reading a body still worth keeping may take in total. */
  readTimeoutMs?: number;
  /** How long such a body may go without sending anything. */
  readIdleMs?: number;
  /** How long the first `HEAD_BYTES` of any body may take in total. */
  headTimeoutMs?: number;
  /** How long a body may go quiet for before its head is in. */
  headIdleMs?: number;
}

/** The read stalled past a deadline. */
const STALLED = Symbol('stalled');

/** Bytes reserved by reads currently in flight. */
let inflightBytes = 0;

/** Reads currently being shed for want of room. */
let shedReads = 0;

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

function where(request: Request): string {
  return `${request.method} ${new URL(request.url).pathname}`;
}

interface Consumed {
  head: Uint8Array;
  bytes: number;
  /** Present only when the caller asked to keep the body and nothing refused it. */
  body: ArrayBuffer | null;
  refusal: Refusal | null;
}

/**
 * Read a request body to its end, keeping at most what was asked for.
 *
 * Content-Length alone isn't enough — a chunked body doesn't send one, and a
 * declared length is only a claim — so the bytes are counted as they arrive.
 * Once a body is refused, nothing past the head is kept: the rest is read and
 * discarded, so memory stays at the head plus one chunk.
 *
 * Discarding rather than cancelling is the whole point. Cancelling the reader
 * destroys the underlying socket, and the client — still uploading — gets a
 * connection reset instead of the response we wrote for it. Reading to the end
 * costs bandwidth we were going to receive anyway and leaves a live socket to
 * answer on. That courtesy has bounds — `drainHeadroom` bytes, `drainIdleMs`
 * of silence, `drainTimeoutMs` in all, and `BUSY_DRAIN_*` in place of all
 * three once the server is out of room — and past any of them this stops
 * reading, which lets the platform close the connection on a body it never
 * finished. Whatever is on the other end of that one is either not a visitor
 * waiting for a screen, or arriving in a spike that has to be shed somewhere.
 */
async function consume(
  request: Request,
  limit: number,
  keepBody: boolean,
  {
    drainHeadroom = DRAIN_HEADROOM_BYTES,
    drainTimeoutMs = DRAIN_TIMEOUT_MS,
    drainIdleMs = DRAIN_IDLE_MS,
    readTimeoutMs = READ_TIMEOUT_MS,
    readIdleMs = READ_IDLE_MS,
    headTimeoutMs = HEAD_READ_TIMEOUT_MS,
    headIdleMs = HEAD_READ_IDLE_MS,
  }: ReadBounds,
): Promise<Consumed> {
  const declared = Number(request.headers.get('content-length'));
  let over = Number.isFinite(declared) && declared > limit;
  if (!request.body) {
    const head = new Uint8Array();
    if (over) return { head, bytes: 0, body: null, refusal: 'over-limit' };
    return { head, bytes: 0, body: keepBody ? new ArrayBuffer(0) : null, refusal: null };
  }

  // Reserved up front, for the whole read: admitting a request and discovering
  // afterwards that there was no room for it would be no bound at all. What is
  // reserved is what this read can be holding at its peak, not what it means to
  // keep — a buffered body is the chunk list and then the merged copy built
  // from it, and either kind of read has a chunk in hand on top of that.
  const reservation = (keepBody ? 2 * limit : HEAD_BYTES) + CHUNK_ALLOWANCE_BYTES;
  const busy = inflightBytes + reservation > MAX_INFLIGHT_BODY_BYTES;
  // Shedding is cheap but not free — a head and the chunk in hand each — so
  // past `MAX_SHED_READS` at once the read keeps nothing: no reservation, no
  // head, and `SHED_DRAIN_*` in place of the busy budget. The head is empty, so
  // the report route's screen loses the severity it would have carried, which
  // is the trade this depth of spike buys the bound with. What it can't do is
  // skip the read: a body nobody touched is dumped by Node itself, to its end.
  const shedding = busy && shedReads >= MAX_SHED_READS;
  // A refused body is still read to its end, and holding the head is what lets
  // the answer keep the visitor's severity — that much fits regardless.
  let keep = keepBody && !busy && !over;

  // Taken last, so nothing between here and the `finally` below can leak a
  // reservation — a reservation that is never released is a permanent one.
  const reader = request.body.getReader();
  // Nothing is booked at shed depth: nothing is held there past the chunk in
  // hand, and a slot taken would be a slot denied to a read that keeps a head.
  if (!shedding) {
    if (busy) shedReads += 1;
    else inflightBytes += reservation;
  }

  const headChunks: Uint8Array[] = [];
  let headBytes = 0;
  let kept: Uint8Array[] | null = keep ? [] : null;
  let total = 0;
  let failed = false;
  let stalled = false;
  // What the drain may cost, decided by which kind of refusal it is: a body
  // refused for its size is a photo still finishing its upload, and gets the
  // headroom; one refused for want of room is load to shed, and gets almost
  // nothing — but never more than it would have got anyway, since on the small
  // forms the headroom is already tighter than the busy budget.
  const drain = shedding
    ? { ceiling: SHED_DRAIN_BYTES, budgetMs: SHED_DRAIN_MS, idleMs: SHED_DRAIN_MS }
    : busy
      ? {
          ceiling: Math.min(BUSY_DRAIN_BYTES, limit + drainHeadroom),
          budgetMs: BUSY_DRAIN_MS,
          idleMs: BUSY_DRAIN_MS,
        }
      : { ceiling: limit + drainHeadroom, budgetMs: drainTimeoutMs, idleMs: drainIdleMs };
  // Both clocks start now. Which one applies switches with `over`, so a body
  // refused halfway through gets the drain's bounds for what remains — but
  // never past `readDeadline`, which is the whole request's ceiling and sits
  // under Node's own 300s backstop.
  const started = Date.now();
  const readDeadline = started + readTimeoutMs;
  let drainDeadline = Math.min(started + drain.budgetMs, readDeadline);
  // The phase every read begins in, on both clocks below: until `HEAD_BYTES`
  // have arrived, nothing has shown itself to be the slow photo the long bounds
  // exist for, and a reservation held on those bounds for a body that never
  // becomes one is the cheapest denial on the whole surface.
  const headDeadline = started + headTimeoutMs;

  // Past a bound the read simply stops here, without cancelling: cancelling
  // leaves the response unwritten and the socket idling until Node's request
  // timeout, while walking away lets the route answer and lets Node close the
  // connection behind a response whose request body was never finished.
  try {
    for (;;) {
      const refused = over || busy;
      // A shed read keeps no head, so it never leaves this phase — and it is on
      // the tightest bounds in the file already.
      const inHead = !shedding && headBytes < HEAD_BYTES;
      const deadline = refused ? drainDeadline : readDeadline;
      const idle = refused ? drain.idleMs : readIdleMs;
      const remaining = (inHead ? Math.min(headDeadline, deadline) : deadline) - Date.now();
      if (remaining <= 0) {
        stalled = true;
        break;
      }
      // Whichever bound comes first: gone quiet, or out of total time.
      const raced = await readWithin(
        reader,
        Math.min(remaining, inHead ? Math.min(headIdleMs, idle) : idle),
      );
      if (raced === STALLED) {
        stalled = true;
        break;
      }
      if (raced.done) break;
      const value = raced.value;
      total += value.byteLength;
      if (!shedding && headBytes < HEAD_BYTES) {
        // Copied, not sliced: a view would pin this whole chunk in memory.
        const head = value.slice(0, HEAD_BYTES - headBytes);
        headChunks.push(head);
        headBytes += head.byteLength;
      }
      if (!over && total > limit) {
        over = true;
        // The drain's budget is measured from the moment the body was refused
        // — unless there was no room for it to begin with, in which case its
        // clock has been running since the read started. Clamped either way:
        // a body that crosses the cap late must not push the request past the
        // 300s backstop and lose the screen the drain exists to deliver.
        if (!busy) drainDeadline = Math.min(Date.now() + drain.budgetMs, readDeadline);
      }
      if (over || !keep) {
        keep = false;
        kept = null;
        if (total > drain.ceiling) break;
        continue;
      }
      kept!.push(value);
    }
  } catch (err) {
    keep = false;
    kept = null;
    if (over || busy) {
      // Ordinary, on a route whose whole job is receiving phone photos: the
      // visitor closed the tab on an upload the server had already refused.
      // Not an incident, and not a reclassification either — the body was
      // provably over the cap, so that is still what we answer with.
      console.warn(`[request-body] refused body ended early for ${where(request)}`);
    } else {
      // The platform's own limit tripping, a stream error, or a client that
      // hung up. It reaches nobody's screen, so the log is where it is found.
      console.error(`[request-body] read failed for ${where(request)}:`, err);
      failed = true;
    }
  } finally {
    if (!shedding) {
      if (busy) shedReads -= 1;
      else inflightBytes -= reservation;
    }
  }

  const head = concat(headChunks, headBytes);
  // Order matters: what the body did outranks what the server had room for,
  // because the visitor can act on the first and only wait out the second.
  const refusal: Refusal | null = over
    ? 'over-limit'
    : busy
      ? 'busy'
      : failed
        ? 'read-failed'
        : stalled
          ? 'timed-out'
          : null;
  if (refusal !== null) return { head, bytes: total, body: null, refusal };
  const body = kept ? (concat(kept, total).buffer as ArrayBuffer) : null;
  return { head, bytes: total, body, refusal: null };
}

/** Buffer the request body, refusing anything over `limit`. */
export async function readCappedBody(
  request: Request,
  limit: number,
  bounds: ReadBounds = {},
): Promise<CappedBody> {
  const { head, body, refusal } = await consume(request, limit, true, bounds);
  if (refusal !== null || body === null) {
    return { body: null, head, refusal: refusal ?? 'read-failed' };
  }
  return { body, head, refusal: null };
}

/**
 * Read the request body for its leading bytes alone, discarding the rest.
 *
 * For a route that wants a couple of short fields out of a body it was always
 * going to throw away — the report route's optional photo is read and dropped
 * (spec §12), so buffering it would cost megabytes of heap for a boolean. The
 * cap still applies: a body over it is refused, so the visitor gets the screen
 * that keeps their severity rather than a report filed off a truncated form.
 */
export async function readCappedHead(
  request: Request,
  limit: number,
  bounds: ReadBounds = {},
): Promise<CappedHead> {
  const { head, bytes, refusal } = await consume(request, limit, false, bounds);
  return { head, bytes, refusal };
}

/** Parse a body already read and accepted by `readCappedBody`. */
function formDataFrom(request: Request, body: ArrayBuffer): Promise<FormData> {
  return new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body,
  }).formData();
}

/** A body parsed as form fields, or the reason there isn't one. */
export type CappedForm =
  | { form: FormData; refusal: null }
  | { form: null; refusal: Refusal };

/**
 * Every bound a body that can only be short is read under.
 *
 * One place, so the single-button POSTs and the text forms can't drift apart
 * on it: the drain budget is the cap itself (no legitimate sign-in overshoots
 * 64KB by megabytes, and the photo-sized headroom the report route needs would
 * only be an abuse budget here), and the clocks are the short ones, because the
 * reservation these hold inside `MAX_INFLIGHT_BODY_BYTES` is only released when
 * one of them fires.
 */
function formBounds(limit: number): ReadBounds {
  return {
    drainHeadroom: limit,
    drainTimeoutMs: FORM_READ_TIMEOUT_MS,
    drainIdleMs: FORM_READ_IDLE_MS,
    readTimeoutMs: FORM_READ_TIMEOUT_MS,
    readIdleMs: FORM_READ_IDLE_MS,
  };
}

/**
 * A capped body parsed as form fields, for the text-only forms — where an
 * oversized body has nothing worth rescuing.
 *
 * At this size the two copies a parse costs are ~128KB, which is why this path
 * still buffers where the report route no longer does.
 */
export async function readCappedForm(request: Request, limit: number): Promise<CappedForm> {
  const { body, refusal } = await readCappedBody(request, limit, formBounds(limit));
  if (body === null) return { form: null, refusal };
  try {
    return { form: await formDataFrom(request, body), refusal: null };
  } catch (err) {
    // Not form fields at all — a content type the parser can't read. Nobody's
    // browser sends this from these forms, so the log is where it's found.
    console.warn(`[request-body] unparsable form body for ${where(request)}:`, err);
    return { form: null, refusal: 'read-failed' };
  }
}

/**
 * The short plain answer a text-only form gives a body it refused.
 *
 * One place, so sign-in and adopt can't drift apart on it, and so each reason
 * keeps its own status: a 413 sends somebody off to shorten a form that may
 * never have been long.
 */
export function refusalResponse(refusal: Refusal, subject: string): Response {
  switch (refusal) {
    case 'over-limit':
      return new Response(`That ${subject} was too large.`, { status: 413 });
    case 'timed-out':
      return new Response(`That ${subject} took too long to arrive. Please try again.`, {
        status: 408,
      });
    case 'busy':
      return new Response(`The tag is busy right now. Please try again.`, {
        status: 503,
        headers: { 'retry-after': '5' },
      });
    case 'read-failed':
      return new Response(`That ${subject} didn't come through. Please try again.`, { status: 400 });
  }
}

/**
 * Read and drop the body of a form that carries no fields, and answer for it
 * if it turns out to carry one after all.
 *
 * Confirm, escalate, clear and the weekly photo are a single button each, so
 * there is nothing to parse — but a body left unread is not the same as no
 * body: Node answers and then destroys the socket under a request it never
 * finished reading, which can cost the caller the redirect this route just
 * wrote. Reading it to its end under the smallest cap puts every public POST
 * on the same bounds, with no route quietly exempt.
 */
export async function discardBody(request: Request, subject: string): Promise<Response | null> {
  const { refusal } = await readCappedHead(request, MAX_FORM_BYTES, formBounds(MAX_FORM_BYTES));
  return refusal === null ? null : refusalResponse(refusal, subject);
}

/** A capped form, or the answer to send instead of reading one. */
export type ReadForm =
  | { form: FormData; refused: null }
  | { form: null; refused: Response };

/**
 * `readCappedForm` with the refusal already turned into its answer, for the
 * routes that have nothing screen-shaped to say about one. Two lines at the
 * call site, and no route can forget a reason: adding one to `Refusal` makes
 * `refusalResponse` fail to compile until it is handled here, once.
 */
export async function readFormOrRefuse(
  request: Request,
  limit: number,
  subject: string,
): Promise<ReadForm> {
  const { form, refusal } = await readCappedForm(request, limit);
  if (refusal !== null) return { form: null, refused: refusalResponse(refusal, subject) };
  return { form, refused: null };
}

/**
 * The delimiter a multipart body's parts are separated by, off the request's
 * own `content-type`, or `''` when it names none.
 *
 * This is the authority for where one part ends and the next begins, which is
 * why the helpers below take it rather than pattern-matching the body: without
 * it, a `name="..."` a visitor typed into the note is indistinguishable from
 * the header of a part they never sent.
 */
export function multipartBoundary(contentType: string): string {
  const match = /boundary=(?:"([^"]*)"|([^;\s]+))/i.exec(contentType);
  return match ? (match[1] ?? match[2] ?? '') : '';
}

/**
 * The parts of a multipart head, each split into its header block and the
 * value beneath it.
 *
 * Never throws and expects truncation: the head is the first `HEAD_BYTES` of a
 * body, so the last part is normally cut mid-anything. A part whose header
 * block hasn't finished arriving is skipped rather than half-read, and the
 * whole walk is over an 8KB string.
 */
function headParts(head: Uint8Array, boundary: string): Array<{ headers: string; value: string }> {
  if (boundary === '') return [];
  const parts: Array<{ headers: string; value: string }> = [];
  for (const chunk of headText(head).split(`--${boundary}`).slice(1)) {
    const blank = /\r?\n\r?\n/.exec(chunk);
    if (!blank) continue;
    parts.push({
      headers: chunk.slice(0, blank.index),
      // The CRLF before the next delimiter belongs to the delimiter, not to
      // what the visitor typed.
      value: chunk.slice(blank.index + blank[0].length).replace(/\r?\n$/, ''),
    });
  }
  return parts;
}

function partName(headers: string): string | null {
  const match = /name="([^"]*)"/.exec(headers);
  return match ? (match[1] ?? '') : null;
}

/**
 * A named text field out of a multipart body's head, or null if it isn't in
 * there.
 *
 * A truncated body can't go through formData(), and the report route
 * deliberately never buffers one, so the fields it needs are read off the
 * parts that precede the file. That only works while the form puts those parts
 * FIRST — browsers send parts in DOM order, so the care screen's markup keeps
 * the category, the note and the hidden fields ahead of the file input. Keep
 * it that way if the screen ever gains a field.
 *
 * The name is matched against a part's HEADER block only, never against the
 * head at large: the note is a sentence a neighbour typed, and a sentence that
 * happens to read like multipart structure must not be able to answer for a
 * part nobody sent.
 */
export function textFieldFromHead(
  head: Uint8Array,
  name: string,
  boundary: string,
): string | null {
  for (const part of headParts(head, boundary)) {
    if (partName(part.headers) === name) return part.value;
  }
  return null;
}

/** The problem category the care screen sent, or null if the head lacks it. */
export function categoryFromHead(head: Uint8Array, boundary: string): ProblemCategory | null {
  return problemFrom(textFieldFromHead(head, 'category', boundary));
}

/**
 * The free-text note, from the same head.
 *
 * A note is at most `MAX_NOTE_CHARS`, so it fits inside `HEAD_BYTES` several
 * times over, and a note containing a CR or LF — which a textarea can produce
 * — survives whole, because the value runs to the part's delimiter rather than
 * to the first line break.
 */
export function noteFromHead(head: Uint8Array, boundary: string): string {
  return noteFrom(textFieldFromHead(head, 'note', boundary));
}

/**
 * Whether a photo was attached, from the same head.
 *
 * A browser sends the file part with `filename=""` when nobody picked
 * anything, and a real filename when they did — which is the only thing the
 * MVP records about the photo anyway (spec §12). Read off the photo part's own
 * headers, so a `filename="..."` typed into the note answers for nothing.
 */
export function photoAttachedFromHead(head: Uint8Array, boundary: string): boolean {
  for (const part of headParts(head, boundary)) {
    if (partName(part.headers) !== 'photo') continue;
    const filename = /filename="([^"]*)"/.exec(part.headers);
    return filename !== null && (filename[1] ?? '').length > 0;
  }
  return false;
}

/**
 * The head as text.
 *
 * UTF-8, not latin1: the structure we match on is ASCII, but the note carried
 * beside it is a sentence a neighbour typed, and on this block that is
 * routinely Spanish — "está dañado" read as latin1 is stored, echoed and
 * carried back to the too-large screen as "estÃ¡ daÃ±ado".
 *
 * Non-fatal by construction, which the callers rely on: the head is the first
 * `HEAD_BYTES` of a body and so is normally cut mid-anything, and a decoder
 * that threw would cost a visitor the screen. A codepoint split by that cut
 * degrades to U+FFFD instead.
 */
const HEAD_DECODER = new TextDecoder('utf-8');

function headText(head: Uint8Array): string {
  return HEAD_DECODER.decode(head);
}

/**
 * Read enough of a body to mark it consumed, then stop — for a route that has
 * already decided it wants nothing from it.
 *
 * Answering a POST without touching its body is not the cheap path it looks
 * like: Node dumps the body of any request whose response finished unconsumed,
 * reading it to its end with nothing but its own 300s timeout in the way (the
 * 200MB measured in `tests/report-upload.e2e.test.ts`). Taking the first chunk
 * ourselves is what puts the stopping point back in our hands, so a route that
 * refuses before any rule runs — a POST at a tag no binding speaks for — costs
 * the same kilobytes as a read past `MAX_SHED_READS` rather than everything the
 * sender cares to push.
 *
 * Nothing is reserved out of `MAX_INFLIGHT_BODY_BYTES` and nothing is kept:
 * the chunk in hand is the whole footprint. That is exactly what
 * `MAX_SHED_READS` counts, so this takes one of its slots rather than sitting
 * outside both counters — a refusal that nothing bounds is how a flood of
 * POSTs at a tag no binding speaks for would put unaccounted megabytes back on
 * the heap the two of them exist to bound. Past that count it does what a read
 * past it does: keeps its answer, takes the first chunk to mark the body
 * consumed, and stops there. The socket is left live either way, so the
 * route's own answer still reaches whatever is on the other end.
 */
export async function abandonBody(request: Request): Promise<void> {
  // A body already read is one Node has nothing left to dump, and a stream
  // already locked would throw on a second reader — so a route may say this
  // from any position, including after a capped read has refused.
  if (!request.body || request.bodyUsed || request.body.locked) return;
  const reader = request.body.getReader();
  // Taken after the reader, so nothing between here and the `finally` can leak
  // a slot. Past the bound the drain shrinks to a single chunk — the least that
  // still marks the body consumed, which is what keeps Node from dumping the
  // rest of it for us.
  const slot = shedReads < MAX_SHED_READS;
  if (slot) shedReads += 1;
  const ceiling = slot ? SHED_DRAIN_BYTES : 0;
  const deadline = Date.now() + SHED_DRAIN_MS;
  let total = 0;
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const raced = await readWithin(reader, remaining);
      if (raced === STALLED || raced.done) break;
      total += raced.value.byteLength;
      if (total > ceiling) break;
    }
  } catch {
    // A body abandoned before it finished arriving is not an incident: nothing
    // downstream wanted it, and the answer has already been decided.
  } finally {
    if (slot) shedReads -= 1;
  }
}
