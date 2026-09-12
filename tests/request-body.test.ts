import { describe, expect, it, vi } from 'vitest';
import {
  BUSY_DRAIN_BYTES,
  CHUNK_ALLOWANCE_BYTES,
  abandonBody,
  discardBody,
  FORM_READ_IDLE_MS,
  HEAD_BYTES,
  HEAD_READ_IDLE_MS,
  MAX_FORM_BYTES,
  MAX_INFLIGHT_BODY_BYTES,
  MAX_SHED_READS,
  photoAttachedFromHead,
  photoPartFromBody,
  READ_IDLE_MS,
  readCappedBody,
  readCappedBodyWhen,
  readCappedForm,
  readCappedHead,
  SHED_DRAIN_BYTES,
  categoriesFromHead,
  noteFromHead,
} from '../src/lib/request-body';

const BOUNDARY = '----treebedtest';

/** A multipart body shaped like the care screen's: category, then the photo. */
function reportBody(category: string, photoBytes: number): Buffer {
  const fields =
    `--${BOUNDARY}\r\n` +
    'Content-Disposition: form-data; name="category"\r\n\r\n' +
    `${category}\r\n` +
    `--${BOUNDARY}\r\n` +
    'Content-Disposition: form-data; name="photo"; filename="tree.jpg"\r\n' +
    'Content-Type: image/jpeg\r\n\r\n';
  return Buffer.concat([
    Buffer.from(fields),
    Buffer.alloc(photoBytes, 0x7f),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
}

function request(body: Buffer): Request {
  return new Request('http://localhost/t/2mq2amhv/report', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    body: new Uint8Array(body),
  });
}

/**
 * A streamed request, so cancelling vs. draining the body is observable.
 * After `stallAfter` bytes it stops sending without closing — a sender that
 * goes quiet, holding the read open.
 */
function streamedRequest(body: Buffer, chunkBytes: number, stallAfter = Infinity, pauseMs = 0) {
  let cancelled = false;
  let delivered = 0;
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (delivered >= stallAfter) return new Promise<void>(() => {});
      if (pauseMs) await new Promise((resolve) => setTimeout(resolve, pauseMs));
      if (offset >= body.byteLength) return controller.close();
      const chunk = new Uint8Array(body.subarray(offset, offset + chunkBytes));
      offset += chunk.byteLength;
      delivered += chunk.byteLength;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  const req = new Request('http://localhost/t/2mq2amhv/report', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    body: stream,
    // @ts-expect-error — undici requires duplex for a streamed body; it is
    // absent from the DOM lib types.
    duplex: 'half',
  });
  return { req, wasCancelled: () => cancelled, deliveredBytes: () => delivered };
}

/**
 * A short form body that sends one field and then goes quiet — the trickle a
 * single-button POST or a sign-in can be held open by.
 */
function stalledFormRequest() {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('category=litter'));
    },
    pull() {
      return new Promise<void>(() => {});
    },
    cancel() {
      cancelled = true;
    },
  });
  const req = new Request('http://localhost/t/2mq2amhv/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: stream,
    // @ts-expect-error — undici requires duplex for a streamed body; it is
    // absent from the DOM lib types.
    duplex: 'half',
  });
  return { req, wasCancelled: () => cancelled };
}

describe('capped request bodies', () => {
  it('passes a body under the cap through whole', async () => {
    const body = reportBody('guard', 1024);
    const capped = await readCappedBody(request(body), 64 * 1024);
    expect(capped.body).not.toBeNull();
    expect(Buffer.from(capped.body!).equals(body)).toBe(true);
  });

  it('refuses a body over the cap and keeps the fields that came first', async () => {
    const capped = await readCappedBody(request(reportBody('guard', 256 * 1024)), 64 * 1024);
    expect(capped.body).toBeNull();
    expect(capped.refusal).toBe('over-limit');
    // Only the head is retained — the upload is not buffered past it.
    expect(capped.head.byteLength).toBeLessThanOrEqual(8 * 1024);
    expect(categoriesFromHead(capped.head, BOUNDARY)).toEqual(['guard']);
  });

  it('refuses a body whose declared length is over the cap', async () => {
    const capped = await readCappedBody(request(reportBody('thirsty', 1024)), 512);
    expect(capped.body).toBeNull();
    expect(categoriesFromHead(capped.head, BOUNDARY)).toEqual(['thirsty']);
  });

  it('reads a refused body to its end instead of cancelling it', async () => {
    // Cancelling destroys the socket mid-upload, and the client gets a reset
    // instead of the too-large screen that keeps what they picked.
    const body = reportBody('guard', 256 * 1024);
    const { req, wasCancelled, deliveredBytes } = streamedRequest(body, 16 * 1024);
    const capped = await readCappedBody(req, 64 * 1024);
    expect(capped.body).toBeNull();
    expect(categoriesFromHead(capped.head, BOUNDARY)).toEqual(['guard']);
    expect(wasCancelled()).toBe(false);
    expect(deliveredBytes()).toBe(body.byteLength);
  });

  it('keeps only the head of a refused body, never the rest', async () => {
    const { req } = streamedRequest(reportBody('litter', 4 * 1024 * 1024), 64 * 1024);
    const capped = await readCappedBody(req, 64 * 1024);
    expect(capped.head.byteLength).toBe(8 * 1024);
    // The head owns its bytes — no view pinning a megabyte-sized buffer.
    expect(capped.head.buffer.byteLength).toBe(8 * 1024);
  });

  it('drains a photo-sized overshoot on the default headroom', async () => {
    // 3MB over a 1MB cap: the realistic range the too-large screen exists for,
    // well inside the 24MB of headroom, so the socket stays alive to answer on.
    const body = reportBody('litter', 3 * 1024 * 1024);
    const { req, wasCancelled, deliveredBytes } = streamedRequest(body, 64 * 1024);
    const capped = await readCappedBody(req, 1024 * 1024);
    expect(capped.refusal).toBe('over-limit');
    expect(categoriesFromHead(capped.head, BOUNDARY)).toEqual(['litter']);
    expect(wasCancelled()).toBe(false);
    expect(deliveredBytes()).toBe(body.byteLength);
  });

  it('stops reading a body that keeps streaming past the drain headroom', async () => {
    const { req, deliveredBytes, wasCancelled } = streamedRequest(
      reportBody('thirsty', 2 * 1024 * 1024),
      16 * 1024,
    );
    const capped = await readCappedBody(req, 64 * 1024, { drainHeadroom: 128 * 1024 });
    expect(capped.body).toBeNull();
    // Walking away, not cancelling: cancelling here leaves the response
    // unwritten and the socket idling until Node's own request timeout.
    expect(wasCancelled()).toBe(false);
    // Walked away once it passed cap + headroom — not after the whole 2MB.
    expect(deliveredBytes()).toBeLessThan(512 * 1024);
  });

  it('gives up on a refused body that goes quiet', async () => {
    // A sender that stalls would otherwise hold the read until Node's own
    // 300s request timeout, for a request already refused — and it has plenty
    // of total drain budget left, so only the idle bound catches this.
    const { req, wasCancelled } = streamedRequest(
      reportBody('thirsty', 2 * 1024 * 1024),
      16 * 1024,
      96 * 1024,
    );
    const started = Date.now();
    const capped = await readCappedBody(req, 64 * 1024, {
      drainIdleMs: 50,
      drainTimeoutMs: 60_000,
    });
    expect(capped.refusal).toBe('over-limit');
    expect(wasCancelled()).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('gives up on a refused body that outlasts the total drain budget', async () => {
    // Steady, never idle, and still not entitled to hold the read forever.
    const { req, deliveredBytes, wasCancelled } = streamedRequest(
      reportBody('thirsty', 8 * 1024 * 1024),
      8 * 1024,
      Infinity,
      5,
    );
    const capped = await readCappedBody(req, 64 * 1024, {
      drainTimeoutMs: 100,
      drainIdleMs: 60_000,
    });
    expect(capped.refusal).toBe('over-limit');
    expect(wasCancelled()).toBe(false);
    expect(deliveredBytes()).toBeLessThan(8 * 1024 * 1024);
  });

  it('never lets a late refusal outlive the read deadline', async () => {
    // The drain's budget starts when the body is refused, so a body that
    // crosses the cap late would run `time-until-over + drainTimeoutMs` in
    // total — on a slow uplink that lands past Node's own 300s request
    // timeout, which destroys the socket and hands the visitor the connection
    // reset the drain exists to avoid. Here the crossing is at ~110ms of a
    // 400ms read deadline, with a drain budget of a minute behind it.
    const { req, deliveredBytes, wasCancelled } = streamedRequest(
      reportBody('guard', 2 * 1024 * 1024),
      4 * 1024,
      Infinity,
      10,
    );
    const started = Date.now();
    const capped = await readCappedBody(req, 40 * 1024, {
      readTimeoutMs: 400,
      drainTimeoutMs: 60_000,
      drainIdleMs: 60_000,
      drainHeadroom: 8 * 1024 * 1024,
    });
    expect(capped.refusal).toBe('over-limit');
    expect(wasCancelled()).toBe(false);
    // Still answerable: the head made it, so the screen still carries their
    // category — the whole request just fits inside the one deadline.
    expect(categoriesFromHead(capped.head, BOUNDARY)).toEqual(['guard']);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(deliveredBytes()).toBeLessThan(2 * 1024 * 1024);
  });

  it('gives up on a body under the cap that stops arriving', async () => {
    // Nothing refused this one — it just never finished. Only the accepted
    // path's own clock catches it, or it holds a request open until Node's.
    const { req, wasCancelled } = streamedRequest(
      reportBody('litter', 1024 * 1024),
      16 * 1024,
      32 * 1024,
    );
    const capped = await readCappedBody(req, 4 * 1024 * 1024, {
      readIdleMs: 50,
      readTimeoutMs: 60_000,
    });
    // Not 'over-limit' and not 'read-failed': it was neither too big nor broken.
    expect(capped.refusal).toBe('timed-out');
    expect(wasCancelled()).toBe(false);
  });

  it('gives up on a body under the cap that outlasts the total read budget', async () => {
    const { req, deliveredBytes } = streamedRequest(
      reportBody('litter', 8 * 1024 * 1024),
      8 * 1024,
      Infinity,
      5,
    );
    const capped = await readCappedBody(req, 16 * 1024 * 1024, {
      readTimeoutMs: 100,
      readIdleMs: 60_000,
    });
    expect(capped.refusal).toBe('timed-out');
    expect(deliveredBytes()).toBeLessThan(8 * 1024 * 1024);
  });

  it('tells a failed read apart from an oversized one', async () => {
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('socket went away'));
      },
    });
    const req = new Request('http://localhost/t/2mq2amhv/report', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      body: failing,
      // @ts-expect-error — undici requires duplex for a streamed body; it is
      // absent from the DOM lib types.
      duplex: 'half',
    });
    const capped = await readCappedBody(req, 64 * 1024);
    expect(capped.body).toBeNull();
    // Not 'over-limit': nothing about this body was too large, and telling the
    // visitor their photo was would send them to fix the wrong thing.
    expect(capped.refusal).toBe('read-failed');
  });

  it('answers an aborted upload it had already refused with the cap, not an error', async () => {
    // A visitor closing the tab on an upload the server refused ten megabytes
    // ago: ordinary, and the body was provably too large, so that is still the
    // answer — a 400 would cost them the screen that keeps what they picked.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const body = reportBody('guard', 512 * 1024);
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= 256 * 1024) return controller.error(new Error('client hung up'));
          const chunk = new Uint8Array(body.subarray(sent, sent + 32 * 1024));
          sent += chunk.byteLength;
          controller.enqueue(chunk);
        },
      });
      const req = new Request('http://localhost/t/2mq2amhv/report', {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
        body: stream,
        // @ts-expect-error — undici requires duplex for a streamed body; it is
        // absent from the DOM lib types.
        duplex: 'half',
      });
      const capped = await readCappedBody(req, 64 * 1024);
      expect(capped.refusal).toBe('over-limit');
      expect(categoriesFromHead(capped.head, BOUNDARY)).toEqual(['guard']);
      // A cancelled upload is not an incident: one quiet line, no stack.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('reads a Spanish note off the head as the visitor typed it', async () => {
    // The block is heavily Spanish-speaking, so the note is routinely
    // non-ASCII. Read as latin1 — as this once was — "está dañado" is stored,
    // echoed to the steward and carried back to the too-large screen as
    // "estÃ¡ daÃ±ado", and each accent costs two of the 300 characters.
    const note = 'La reja está dañada — hay basura y vidrios rotos aquí.';
    const body = Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\n` +
          'Content-Disposition: form-data; name="category"\r\n\r\nguard\r\n' +
          `--${BOUNDARY}\r\n` +
          'Content-Disposition: form-data; name="note"\r\n\r\n' +
          `${note}\r\n` +
          `--${BOUNDARY}\r\n` +
          'Content-Disposition: form-data; name="photo"; filename="árbol.jpg"\r\n' +
          'Content-Type: image/jpeg\r\n\r\n',
        'utf8',
      ),
      Buffer.alloc(4 * 1024 * 1024, 0x7f),
      Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
    ]);
    const capped = await readCappedHead(request(body), 12 * 1024 * 1024);
    expect(capped.refusal).toBeNull();
    expect(noteFromHead(capped.head, BOUNDARY)).toBe(note);
    expect(categoriesFromHead(capped.head, BOUNDARY)).toEqual(['guard']);
    expect(photoAttachedFromHead(capped.head, BOUNDARY)).toBe(true);
  });

  it('reads only part headers, so a note cannot claim a photo nobody attached', async () => {
    // A neighbour is free to type anything into the free-text box, including
    // something shaped like multipart structure. What decides the fields is the
    // boundary the client declared, so a value can never answer for a part.
    const note =
      'Content-Disposition: form-data; name="photo"; filename="x.jpg"\r\n\r\nname="category"\r\n\r\nlitter';
    const body = Buffer.from(
      `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="category"\r\n\r\nguard\r\n' +
        `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="note"\r\n\r\n' +
        `${note}\r\n` +
        `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="photo"; filename=""\r\n' +
        'Content-Type: application/octet-stream\r\n\r\n' +
        `\r\n--${BOUNDARY}--\r\n`,
      'utf8',
    );
    const capped = await readCappedHead(request(body), 12 * 1024 * 1024);
    expect(capped.refusal).toBeNull();
    expect(photoAttachedFromHead(capped.head, BOUNDARY)).toBe(false);
    expect(categoriesFromHead(capped.head, BOUNDARY)).toEqual(['guard']);
    // Carried whole, with its whitespace collapsed the way every typed field's
    // is (`capped`): what matters here is that it stays a NOTE and never
    // answers for a part.
    expect(noteFromHead(capped.head, BOUNDARY)).toBe(note.replace(/\s+/g, ' '));
  });

  it('reports no category rather than guessing one', async () => {
    expect(categoriesFromHead(new Uint8Array(), BOUNDARY)).toEqual([]);
    const noField = Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="photo"\r\n\r\nxx\r\n--${BOUNDARY}--\r\n`,
    );
    expect(categoriesFromHead(new Uint8Array(noField), BOUNDARY)).toEqual([]);
    const notACategory = reportBody('nope', 16);
    expect(categoriesFromHead(new Uint8Array(notACategory), BOUNDARY)).toEqual([]);
  });

  it('reads every category part the picker sent, deduplicated, in tile order', async () => {
    // The tiles are checkboxes, so a browser sends one `category` part per
    // pressed tile. Submission order and a hand-built duplicate change
    // nothing; a value naming no tile is dropped without taking the rest.
    const body = Buffer.from(
      `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="category"\r\n\r\nguard\r\n' +
        `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="category"\r\n\r\nthirsty\r\n' +
        `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="category"\r\n\r\nguard\r\n' +
        `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="category"\r\n\r\nnope\r\n' +
        `--${BOUNDARY}--\r\n`,
      'utf8',
    );
    const capped = await readCappedHead(request(body), 12 * 1024 * 1024);
    expect(capped.refusal).toBeNull();
    expect(categoriesFromHead(capped.head, BOUNDARY)).toEqual(['thirsty', 'guard']);
  });
});

describe('head-only reads', () => {
  it('takes the report route’s two fields off the head and keeps no photo', async () => {
    const body = reportBody('guard', 4 * 1024 * 1024);
    const { req, wasCancelled, deliveredBytes } = streamedRequest(body, 64 * 1024);
    const capped = await readCappedHead(req, 12 * 1024 * 1024);

    expect(capped.refusal).toBeNull();
    expect(categoriesFromHead(capped.head, BOUNDARY)).toEqual(['guard']);
    expect(photoAttachedFromHead(capped.head, BOUNDARY)).toBe(true);
    // The whole body arrived and was counted; only the head was ever held.
    expect(capped.bytes).toBe(body.byteLength);
    expect(capped.head.byteLength).toBe(HEAD_BYTES);
    expect(capped.head.buffer.byteLength).toBe(HEAD_BYTES);
    expect(wasCancelled()).toBe(false);
    expect(deliveredBytes()).toBe(body.byteLength);
  });

  it('refuses one over the cap, with the severity still readable', async () => {
    const { req, wasCancelled } = streamedRequest(reportBody('thirsty', 512 * 1024), 64 * 1024);
    const capped = await readCappedHead(req, 64 * 1024);
    expect(capped.refusal).toBe('over-limit');
    expect(categoriesFromHead(capped.head, BOUNDARY)).toEqual(['thirsty']);
    expect(wasCancelled()).toBe(false);
  });

  it('reads no photo where nobody picked one', () => {
    const empty = Buffer.from(
      `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="severity"\r\n\r\n1\r\n' +
        `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="photo"; filename=""\r\n' +
        'Content-Type: application/octet-stream\r\n\r\n' +
        `\r\n--${BOUNDARY}--\r\n`,
    );
    expect(photoAttachedFromHead(new Uint8Array(empty), BOUNDARY)).toBe(false);
    expect(photoAttachedFromHead(new Uint8Array(), BOUNDARY)).toBe(false);
    expect(photoAttachedFromHead(new Uint8Array(reportBody('litter', 16)), BOUNDARY)).toBe(true);
  });
});

describe('conditional reads: keep the body only when its head shows a photo', () => {
  const wantsPhoto = (head: Uint8Array) => photoAttachedFromHead(head, BOUNDARY);

  it('keeps a photo-carrying body whole, and the photo reads back out of it', async () => {
    const photoBytes = 4 * 1024 * 1024;
    const { req, wasCancelled } = streamedRequest(reportBody('guard', photoBytes), 64 * 1024);
    const capped = await readCappedBodyWhen(req, 12 * 1024 * 1024, wantsPhoto);

    expect(capped.refusal).toBeNull();
    expect(capped.body).not.toBeNull();
    expect(categoriesFromHead(capped.head, BOUNDARY)).toEqual(['guard']);
    const photo = photoPartFromBody(capped.body!, BOUNDARY);
    expect(photo).not.toBeNull();
    expect(photo!.contentType).toBe('image/jpeg');
    expect(photo!.bytes.byteLength).toBe(photoBytes);
    // The extracted bytes are the photo's own, ends included — not the
    // delimiter's CRLF and not a byte short.
    expect(photo!.bytes[0]).toBe(0x7f);
    expect(photo!.bytes[photoBytes - 1]).toBe(0x7f);
    expect(wasCancelled()).toBe(false);
  });

  it('discards a body whose head shows no photo, fields still readable', async () => {
    // A photo part with filename="" is nobody attaching anything; padding
    // pushes the body past the head so the in-loop decision is the one taken.
    const body = Buffer.from(
      `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="category"\r\n\r\nlitter\r\n' +
        `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="photo"; filename=""\r\n' +
        'Content-Type: application/octet-stream\r\n\r\n' +
        'x'.repeat(64 * 1024) +
        `\r\n--${BOUNDARY}--\r\n`,
    );
    const capped = await readCappedBodyWhen(request(body), 12 * 1024 * 1024, wantsPhoto);
    expect(capped.refusal).toBeNull();
    expect(capped.body).toBeNull();
    expect(categoriesFromHead(capped.head, BOUNDARY)).toEqual(['litter']);
  });

  it('keeps a body smaller than the head, deciding on what there is', async () => {
    // Under HEAD_BYTES the in-loop decision never fires; the whole body is
    // already in hand and is decided — and extracted — at the end.
    const capped = await readCappedBodyWhen(request(reportBody('litter', 16)), 64 * 1024, wantsPhoto);
    expect(capped.refusal).toBeNull();
    const photo = photoPartFromBody(capped.body!, BOUNDARY);
    expect(photo!.bytes.byteLength).toBe(16);
  });

  it('refuses over the cap with the head kept, like every report refusal', async () => {
    const capped = await readCappedBodyWhen(request(reportBody('thirsty', 512 * 1024)), 64 * 1024, wantsPhoto);
    expect(capped.refusal).toBe('over-limit');
    expect(capped.body).toBeNull();
    expect(categoriesFromHead(capped.head, BOUNDARY)).toEqual(['thirsty']);
  });

  it('extracts no photo from a note that merely mentions one', () => {
    // The note precedes the file part on the care screen; text a visitor
    // typed must not be able to answer for a part nobody sent.
    const sly = Buffer.from(
      `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="note"\r\n\r\n' +
        'name="photo"; filename="gotcha.jpg" is what I typed\r\n' +
        `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="photo"; filename=""\r\n\r\n' +
        `\r\n--${BOUNDARY}--\r\n`,
    );
    expect(photoPartFromBody(new Uint8Array(sly), BOUNDARY)).toBeNull();
    expect(photoPartFromBody(new Uint8Array(reportBody('guard', 8)), '')).toBeNull();
  });
});

describe('abandoning a body', () => {
  it('takes an untouched body to the drain bound and stops', async () => {
    const req = request(reportBody('litter', 4 * 1024 * 1024));
    await abandonBody(req);
    expect(req.bodyUsed).toBe(true);
  });

  it('is a no-op once the body has been read, so any route can say it', async () => {
    // `clear` and `photo` read their body first and can still refuse
    // afterwards — a binding pointing at a site the store has never heard of.
    // A second reader on a consumed stream throws, and that 404 must not
    // become a 500.
    const req = request(reportBody('litter', 1024));
    await discardBody(req, 'update');
    await expect(abandonBody(req)).resolves.toBeUndefined();
  });

  it('is a no-op with no body at all, so a GET screen pays nothing', async () => {
    const get = new Request('http://localhost/t/2mq2amhv');
    await expect(abandonBody(get)).resolves.toBeUndefined();
  });
});

describe('the in-flight budget', () => {
  /** A body that arrives in one chunk and then waits to be let go. */
  function gatedRequest(body: Buffer) {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (sent) {
          await gate;
          return controller.close();
        }
        sent = true;
        controller.enqueue(new Uint8Array(body));
      },
    });
    const req = new Request('http://localhost/t/2mq2amhv/report', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      body: stream,
      // @ts-expect-error — undici requires duplex for a streamed body; it is
      // absent from the DOM lib types.
      duplex: 'half',
    });
    return { req, release: () => release() };
  }

  /**
   * A buffered read's cap sized so its reservation leaves `free` bytes of the
   * budget behind — the reservation being twice the cap plus a chunk.
   */
  function capLeaving(free: number): number {
    return (MAX_INFLIGHT_BODY_BYTES - CHUNK_ALLOWANCE_BYTES - free) / 2;
  }

  /** A read holding its reservation until it is released. */
  async function hold(cap: number) {
    const holding = gatedRequest(reportBody('litter', 1024));
    const held = readCappedBody(holding.req, cap);
    await new Promise((resolve) => setImmediate(resolve));
    return { release: holding.release, settled: () => held };
  }

  it('refuses a read there is no room for, and admits it once there is', async () => {
    const holding = await hold(capLeaving(8 * 1024 * 1024));

    const cap = 20 * 1024 * 1024;
    const crowded = await readCappedBody(request(reportBody('guard', 1024)), cap);
    // Not 'over-limit': this body was small. The server had no room for it,
    // and it was read to its end so the answer reaches whoever sent it.
    expect(crowded.refusal).toBe('busy');
    expect(crowded.body).toBeNull();
    // Enough was kept to carry their severity to the screen that offers a retry.
    expect(categoriesFromHead(crowded.head, BOUNDARY)).toEqual(['guard']);

    holding.release();
    expect((await holding.settled()).refusal).toBeNull();

    // The reservation is released with the read, not leaked past it.
    const after = await readCappedBody(request(reportBody('thirsty', 1024)), cap);
    expect(after.refusal).toBeNull();
  });

  it('costs a head-only read only its head, so uploads keep being admitted', async () => {
    const holding = await hold(capLeaving(8 * 1024 * 1024));

    // No room at all for another buffered read of that size — but a head-only
    // read holds kilobytes, which is what keeps the report route open to
    // hundreds of concurrent phone uploads.
    const alongside = await readCappedHead(request(reportBody('guard', 1024)), 12 * 1024 * 1024);
    expect(alongside.refusal).toBeNull();

    holding.release();
    expect((await holding.settled()).refusal).toBeNull();
  });

  it('refuses a photo upload whose upgrade has no room, head kept', async () => {
    // Room for a head-only read but not for the buffered share a photo needs:
    // the conditional read admits, sees the photo in the head, finds the
    // budget full at the moment it matters, and refuses as busy — with the
    // head kept, so the busy screen still carries what the visitor picked.
    const holding = await hold(
      capLeaving(HEAD_BYTES + CHUNK_ALLOWANCE_BYTES + 1024 * 1024),
    );

    const cap = 12 * 1024 * 1024;
    const wantsPhoto = (head: Uint8Array) => photoAttachedFromHead(head, BOUNDARY);
    const crowded = await readCappedBodyWhen(request(reportBody('guard', 64 * 1024)), cap, wantsPhoto);
    expect(crowded.refusal).toBe('busy');
    expect(crowded.body).toBeNull();
    expect(categoriesFromHead(crowded.head, BOUNDARY)).toEqual(['guard']);

    // A photo-less report the same moment stays admitted: it never asks for
    // the upgrade, which is the whole point of deciding off the head.
    const body = Buffer.from(
      `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="category"\r\n\r\nlitter\r\n' +
        `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="photo"; filename=""\r\n\r\n' +
        `\r\n--${BOUNDARY}--\r\n`,
    );
    const plain = await readCappedBodyWhen(request(body), cap, wantsPhoto);
    expect(plain.refusal).toBeNull();

    holding.release();
    expect((await holding.settled()).refusal).toBeNull();

    // With the room back, the same upload is admitted and kept whole.
    const after = await readCappedBodyWhen(request(reportBody('guard', 64 * 1024)), cap, wantsPhoto);
    expect(after.refusal).toBeNull();
    expect(photoPartFromBody(after.body!, BOUNDARY)!.bytes.byteLength).toBe(64 * 1024);
  });

  it('counts the chunk in hand, not just the head it keeps', async () => {
    // Room for the head and nothing else. A read holds the chunk it is looking
    // at as well as the bytes it decided to keep, and reserving only the latter
    // under-counted the report route by the better part of an order of
    // magnitude — a budget that admits eight times what it can hold is no
    // budget at all.
    const holding = await hold(capLeaving(HEAD_BYTES + 1024));

    const crowded = await readCappedHead(request(reportBody('guard', 1024)), 12 * 1024 * 1024);
    expect(crowded.refusal).toBe('busy');

    holding.release();
    await holding.settled();
  });

  it('stops reading a body it has no room for instead of draining it', async () => {
    // The shed that makes the budget mean something: a refusal that costs the
    // same ingress as an admitted upload sheds nothing.
    const holding = await hold(capLeaving(1024));

    const { req, deliveredBytes, wasCancelled } = streamedRequest(
      reportBody('guard', 8 * 1024 * 1024),
      64 * 1024,
    );
    const crowded = await readCappedHead(req, 12 * 1024 * 1024);
    expect(crowded.refusal).toBe('busy');
    expect(wasCancelled()).toBe(false);
    // A chunk of slack either side: the read stops on the chunk that crosses
    // the budget, and the stream has already pulled the next one behind it.
    expect(deliveredBytes()).toBeLessThanOrEqual(BUSY_DRAIN_BYTES + 2 * CHUNK_ALLOWANCE_BYTES);

    holding.release();
    await holding.settled();
  });

  it('bounds how many reads it sheds at once, and keeps nothing past that', async () => {
    // The byte budget covers admitted reads; shed ones hold a head and the
    // chunk in hand of their own, so without a count they sit outside the very
    // bound they were refused by. Past this many a read keeps nothing at all
    // and stops at SHED_DRAIN_BYTES — it still reads that much, because a body
    // left untouched is one Node dumps to its end on our behalf.
    const holding = await hold(capLeaving(1024));
    const shedding = Array.from({ length: MAX_SHED_READS }, () => {
      const gated = gatedRequest(reportBody('litter', 1024));
      return { release: gated.release, settled: readCappedHead(gated.req, 12 * 1024 * 1024) };
    });

    const { req, deliveredBytes, wasCancelled } = streamedRequest(
      reportBody('guard', 4 * SHED_DRAIN_BYTES),
      8 * 1024,
    );
    const beyond = await readCappedHead(req, 12 * 1024 * 1024);

    for (const shed of shedding) shed.release();
    const shedRefusals = await Promise.all(shedding.map((shed) => shed.settled));
    // A shed slot is released with its read, so the next one is read again.
    const after = await readCappedHead(request(reportBody('thirsty', 1024)), 12 * 1024 * 1024);
    holding.release();
    await holding.settled();

    expect(beyond.refusal).toBe('busy');
    // Nothing kept, and the ingress stopped at the shed drain rather than at
    // whatever the sender had left — this is what the peak heap claim rests on
    // past the shed count, and what walking away instead would have cost.
    expect(beyond.head.byteLength).toBe(0);
    expect(beyond.bytes).toBeLessThanOrEqual(SHED_DRAIN_BYTES + CHUNK_ALLOWANCE_BYTES);
    expect(deliveredBytes()).toBeLessThanOrEqual(SHED_DRAIN_BYTES + 2 * CHUNK_ALLOWANCE_BYTES);
    // Not cancelled: the socket has to survive to carry the busy screen.
    expect(wasCancelled()).toBe(false);
    // The cost: no head means no severity, which the busy screen does without.
    expect(categoriesFromHead(beyond.head, BOUNDARY)).toEqual([]);

    expect(shedRefusals.every((shed) => shed.refusal === 'busy')).toBe(true);
    expect(after.refusal).toBe('busy');
    expect(categoriesFromHead(after.head, BOUNDARY)).toEqual(['thirsty']);
  });

  it('tells a shed read that was also oversized which of the two it was', async () => {
    // The refusal ladder's own precedence, which the shed path used to invert:
    // a 20MB photo told "the tag is busy" retries the same photo forever, where
    // "that photo was too large" is the one thing they can act on.
    const holding = await hold(capLeaving(1024));
    const shedding = Array.from({ length: MAX_SHED_READS }, () => {
      const gated = gatedRequest(reportBody('litter', 1024));
      return { release: gated.release, settled: readCappedHead(gated.req, 12 * 1024 * 1024) };
    });

    // Declared over the cap by its own Content-Length, and arriving with no
    // room left for it: both true at once, and only one of them is actionable.
    const beyond = await readCappedHead(request(reportBody('guard', 256 * 1024)), 64 * 1024);

    for (const shed of shedding) shed.release();
    await Promise.all(shedding.map((shed) => shed.settled));
    holding.release();
    await holding.settled();

    expect(beyond.refusal).toBe('over-limit');
  });

  it('holds a body that can only be short for seconds, not the photo route’s minutes', async () => {
    // The bound that fires is the bound that gives the reservation back, so
    // the photo-sized clocks on these routes were what let a trickle deny the
    // server: one byte every 25s held a slot for four minutes, and a few
    // hundred such sockets exhausted the whole in-flight budget between them.
    // Both paths at once, and on a driven clock: the assertion is which bound
    // fires, and waiting out the real one would put seconds into the fast suite.
    vi.useFakeTimers();
    try {
      const single = stalledFormRequest();
      const typed = stalledFormRequest();
      const button = discardBody(single.req, 'confirmation');
      const form = readCappedForm(typed.req, MAX_FORM_BYTES);
      let settled = false;
      const both = Promise.all([button, form]).then((answers) => {
        settled = true;
        return answers;
      });

      // One tick short of the form's own idle bound, both are still reading —
      // so this is the bound being measured, not something else finishing early.
      await vi.advanceTimersByTimeAsync(FORM_READ_IDLE_MS - 1);
      expect(settled).toBe(false);

      // One tick past it, both are answered. On the photo route's clocks these
      // would still be holding their reservations 25 seconds from here.
      await vi.advanceTimersByTimeAsync(2);
      expect(settled).toBe(true);
      expect(FORM_READ_IDLE_MS).toBeLessThan(READ_IDLE_MS);

      const [answer, refused] = await both;
      expect(answer?.status).toBe(408);
      expect(refused.refusal).toBe('timed-out');
      // Walked away from, not cancelled: the route still has a socket to answer on.
      expect(single.wasCancelled()).toBe(false);
      expect(typed.wasCancelled()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives even the photo route only seconds to send its head', async () => {
    // The one route that genuinely needs minutes, and until the head is in
    // there is nothing to spend them on: a report with no photo is a few
    // hundred bytes in total, and a phone puts the first chunk of a 20MB upload
    // on the wire in well under a second. On the long clocks this was the
    // cheapest reservation on the whole surface — a byte every 29s from a few
    // hundred cookie-less sockets holds the in-flight budget shut for minutes.
    vi.useFakeTimers();
    try {
      const { req, wasCancelled } = streamedRequest(
        reportBody('litter', 4 * 1024 * 1024),
        4 * 1024,
        4 * 1024,
      );
      let settled = false;
      const reading = readCappedHead(req, 12 * 1024 * 1024).then((capped) => {
        settled = true;
        return capped;
      });

      // Short of the head's own idle bound, still reading — so it is that bound
      // being measured and not something else finishing early.
      await vi.advanceTimersByTimeAsync(HEAD_READ_IDLE_MS - 1);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(2);
      expect(settled).toBe(true);
      expect(HEAD_READ_IDLE_MS).toBeLessThan(READ_IDLE_MS);

      const capped = await reading;
      expect(capped.refusal).toBe('timed-out');
      // Walked away from, not cancelled: the route still has a socket to answer
      // on, so this reaches the screen that keeps the report.
      expect(wasCancelled()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives the photo route its minutes once a photo is actually arriving', async () => {
    // The other half of the same bound: a real upload pausing longer than the
    // head clock is exactly the slow-uplink case the graceful screen exists
    // for, and it must keep the long clocks it was sized with.
    vi.useFakeTimers();
    try {
      const { req } = streamedRequest(reportBody('guard', 4 * 1024 * 1024), 16 * 1024, 16 * 1024);
      let settled = false;
      const reading = readCappedHead(req, 12 * 1024 * 1024).then((capped) => {
        settled = true;
        return capped;
      });

      // The first chunk carries the whole head, so the short clock is done with.
      await vi.advanceTimersByTimeAsync(10);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(HEAD_READ_IDLE_MS);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(READ_IDLE_MS);
      expect(settled).toBe(true);
      const capped = await reading;
      expect(capped.refusal).toBe('timed-out');
      expect(categoriesFromHead(capped.head, BOUNDARY)).toEqual(['guard']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still reads a small refused body to its end, so the answer reaches it', async () => {
    // Everything carrying something a person typed is far under the busy
    // drain: a sign-in, an adopt form, a refile, a single-button POST. Those
    // keep the answer they would have had.
    const holding = await hold(capLeaving(1024));

    const body = reportBody('litter', 16 * 1024);
    const { req, deliveredBytes } = streamedRequest(body, 4 * 1024);
    const crowded = await readCappedHead(req, 12 * 1024 * 1024);
    expect(crowded.refusal).toBe('busy');
    expect(deliveredBytes()).toBe(body.byteLength);
    expect(categoriesFromHead(crowded.head, BOUNDARY)).toEqual(['litter']);

    holding.release();
    await holding.settled();
  });
});
