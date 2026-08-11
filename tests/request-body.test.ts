import { describe, expect, it, vi } from 'vitest';
import {
  BUSY_DRAIN_BYTES,
  CHUNK_ALLOWANCE_BYTES,
  HEAD_BYTES,
  MAX_INFLIGHT_BODY_BYTES,
  photoAttachedFromHead,
  readCappedBody,
  readCappedHead,
  severityIndexFromHead,
} from '../src/lib/request-body';

const BOUNDARY = '----treebedtest';

/** A multipart body shaped like the severity sheet's: severity, then the photo. */
function reportBody(severityIndex: string, photoBytes: number): Buffer {
  const fields =
    `--${BOUNDARY}\r\n` +
    'Content-Disposition: form-data; name="severity"\r\n\r\n' +
    `${severityIndex}\r\n` +
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
  return new Request('http://localhost/b/BED-HRL-0847/report', {
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
  const req = new Request('http://localhost/b/BED-HRL-0847/report', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    body: stream,
    // @ts-expect-error — undici requires duplex for a streamed body; it is
    // absent from the DOM lib types.
    duplex: 'half',
  });
  return { req, wasCancelled: () => cancelled, deliveredBytes: () => delivered };
}

describe('capped request bodies', () => {
  it('passes a body under the cap through whole', async () => {
    const body = reportBody('2', 1024);
    const capped = await readCappedBody(request(body), 64 * 1024);
    expect(capped.body).not.toBeNull();
    expect(Buffer.from(capped.body!).equals(body)).toBe(true);
  });

  it('refuses a body over the cap and keeps the fields that came first', async () => {
    const capped = await readCappedBody(request(reportBody('2', 256 * 1024)), 64 * 1024);
    expect(capped.body).toBeNull();
    expect(capped.refusal).toBe('over-limit');
    // Only the head is retained — the upload is not buffered past it.
    expect(capped.head.byteLength).toBeLessThanOrEqual(8 * 1024);
    expect(severityIndexFromHead(capped.head)).toBe(2);
  });

  it('refuses a body whose declared length is over the cap', async () => {
    const capped = await readCappedBody(request(reportBody('0', 1024)), 512);
    expect(capped.body).toBeNull();
    expect(severityIndexFromHead(capped.head)).toBe(0);
  });

  it('reads a refused body to its end instead of cancelling it', async () => {
    // Cancelling destroys the socket mid-upload, and the client gets a reset
    // instead of the too-large screen that keeps its severity.
    const body = reportBody('2', 256 * 1024);
    const { req, wasCancelled, deliveredBytes } = streamedRequest(body, 16 * 1024);
    const capped = await readCappedBody(req, 64 * 1024);
    expect(capped.body).toBeNull();
    expect(severityIndexFromHead(capped.head)).toBe(2);
    expect(wasCancelled()).toBe(false);
    expect(deliveredBytes()).toBe(body.byteLength);
  });

  it('keeps only the head of a refused body, never the rest', async () => {
    const { req } = streamedRequest(reportBody('1', 4 * 1024 * 1024), 64 * 1024);
    const capped = await readCappedBody(req, 64 * 1024);
    expect(capped.head.byteLength).toBe(8 * 1024);
    // The head owns its bytes — no view pinning a megabyte-sized buffer.
    expect(capped.head.buffer.byteLength).toBe(8 * 1024);
  });

  it('drains a photo-sized overshoot on the default headroom', async () => {
    // 3MB over a 1MB cap: the realistic range the too-large screen exists for,
    // well inside the 24MB of headroom, so the socket stays alive to answer on.
    const body = reportBody('1', 3 * 1024 * 1024);
    const { req, wasCancelled, deliveredBytes } = streamedRequest(body, 64 * 1024);
    const capped = await readCappedBody(req, 1024 * 1024);
    expect(capped.refusal).toBe('over-limit');
    expect(severityIndexFromHead(capped.head)).toBe(1);
    expect(wasCancelled()).toBe(false);
    expect(deliveredBytes()).toBe(body.byteLength);
  });

  it('stops reading a body that keeps streaming past the drain headroom', async () => {
    const { req, deliveredBytes, wasCancelled } = streamedRequest(
      reportBody('0', 2 * 1024 * 1024),
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
      reportBody('0', 2 * 1024 * 1024),
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
      reportBody('0', 8 * 1024 * 1024),
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

  it('gives up on a body under the cap that stops arriving', async () => {
    // Nothing refused this one — it just never finished. Only the accepted
    // path's own clock catches it, or it holds a request open until Node's.
    const { req, wasCancelled } = streamedRequest(
      reportBody('1', 1024 * 1024),
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
      reportBody('1', 8 * 1024 * 1024),
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
    const req = new Request('http://localhost/b/BED-HRL-0847/report', {
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
    // answer — a 400 would cost them the screen that keeps their severity.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const body = reportBody('2', 512 * 1024);
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= 256 * 1024) return controller.error(new Error('client hung up'));
          const chunk = new Uint8Array(body.subarray(sent, sent + 32 * 1024));
          sent += chunk.byteLength;
          controller.enqueue(chunk);
        },
      });
      const req = new Request('http://localhost/b/BED-HRL-0847/report', {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
        body: stream,
        // @ts-expect-error — undici requires duplex for a streamed body; it is
        // absent from the DOM lib types.
        duplex: 'half',
      });
      const capped = await readCappedBody(req, 64 * 1024);
      expect(capped.refusal).toBe('over-limit');
      expect(severityIndexFromHead(capped.head)).toBe(2);
      // A cancelled upload is not an incident: one quiet line, no stack.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('reports no severity rather than guessing one', async () => {
    expect(severityIndexFromHead(new Uint8Array())).toBeNull();
    const noField = Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="photo"\r\n\r\nxx\r\n--${BOUNDARY}--\r\n`,
    );
    expect(severityIndexFromHead(new Uint8Array(noField))).toBeNull();
    const outOfRange = reportBody('9', 16);
    expect(severityIndexFromHead(new Uint8Array(outOfRange))).toBeNull();
  });
});

describe('head-only reads', () => {
  it('takes the report route’s two fields off the head and keeps no photo', async () => {
    const body = reportBody('2', 4 * 1024 * 1024);
    const { req, wasCancelled, deliveredBytes } = streamedRequest(body, 64 * 1024);
    const capped = await readCappedHead(req, 12 * 1024 * 1024);

    expect(capped.refusal).toBeNull();
    expect(severityIndexFromHead(capped.head)).toBe(2);
    expect(photoAttachedFromHead(capped.head)).toBe(true);
    // The whole body arrived and was counted; only the head was ever held.
    expect(capped.bytes).toBe(body.byteLength);
    expect(capped.head.byteLength).toBe(HEAD_BYTES);
    expect(capped.head.buffer.byteLength).toBe(HEAD_BYTES);
    expect(wasCancelled()).toBe(false);
    expect(deliveredBytes()).toBe(body.byteLength);
  });

  it('refuses one over the cap, with the severity still readable', async () => {
    const { req, wasCancelled } = streamedRequest(reportBody('0', 512 * 1024), 64 * 1024);
    const capped = await readCappedHead(req, 64 * 1024);
    expect(capped.refusal).toBe('over-limit');
    expect(severityIndexFromHead(capped.head)).toBe(0);
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
    expect(photoAttachedFromHead(new Uint8Array(empty))).toBe(false);
    expect(photoAttachedFromHead(new Uint8Array())).toBe(false);
    expect(photoAttachedFromHead(new Uint8Array(reportBody('1', 16)))).toBe(true);
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
    const req = new Request('http://localhost/b/BED-HRL-0847/report', {
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
    const holding = gatedRequest(reportBody('1', 1024));
    const held = readCappedBody(holding.req, cap);
    await new Promise((resolve) => setImmediate(resolve));
    return { release: holding.release, settled: () => held };
  }

  it('refuses a read there is no room for, and admits it once there is', async () => {
    const holding = await hold(capLeaving(8 * 1024 * 1024));

    const cap = 20 * 1024 * 1024;
    const crowded = await readCappedBody(request(reportBody('2', 1024)), cap);
    // Not 'over-limit': this body was small. The server had no room for it,
    // and it was read to its end so the answer reaches whoever sent it.
    expect(crowded.refusal).toBe('busy');
    expect(crowded.body).toBeNull();
    // Enough was kept to carry their severity to the screen that offers a retry.
    expect(severityIndexFromHead(crowded.head)).toBe(2);

    holding.release();
    expect((await holding.settled()).refusal).toBeNull();

    // The reservation is released with the read, not leaked past it.
    const after = await readCappedBody(request(reportBody('0', 1024)), cap);
    expect(after.refusal).toBeNull();
  });

  it('costs a head-only read only its head, so uploads keep being admitted', async () => {
    const holding = await hold(capLeaving(8 * 1024 * 1024));

    // No room at all for another buffered read of that size — but a head-only
    // read holds kilobytes, which is what keeps the report route open to
    // hundreds of concurrent phone uploads.
    const alongside = await readCappedHead(request(reportBody('2', 1024)), 12 * 1024 * 1024);
    expect(alongside.refusal).toBeNull();

    holding.release();
    expect((await holding.settled()).refusal).toBeNull();
  });

  it('counts the chunk in hand, not just the head it keeps', async () => {
    // Room for the head and nothing else. A read holds the chunk it is looking
    // at as well as the bytes it decided to keep, and reserving only the latter
    // under-counted the report route by the better part of an order of
    // magnitude — a budget that admits eight times what it can hold is no
    // budget at all.
    const holding = await hold(capLeaving(HEAD_BYTES + 1024));

    const crowded = await readCappedHead(request(reportBody('2', 1024)), 12 * 1024 * 1024);
    expect(crowded.refusal).toBe('busy');

    holding.release();
    await holding.settled();
  });

  it('stops reading a body it has no room for instead of draining it', async () => {
    // The shed that makes the budget mean something: a refusal that costs the
    // same ingress as an admitted upload sheds nothing.
    const holding = await hold(capLeaving(1024));

    const { req, deliveredBytes, wasCancelled } = streamedRequest(
      reportBody('2', 8 * 1024 * 1024),
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

  it('still reads a small refused body to its end, so the answer reaches it', async () => {
    // Everything carrying something a person typed is far under the busy
    // drain: a sign-in, an adopt form, a refile, a single-button POST. Those
    // keep the answer they would have had.
    const holding = await hold(capLeaving(1024));

    const body = reportBody('1', 16 * 1024);
    const { req, deliveredBytes } = streamedRequest(body, 4 * 1024);
    const crowded = await readCappedHead(req, 12 * 1024 * 1024);
    expect(crowded.refusal).toBe('busy');
    expect(deliveredBytes()).toBe(body.byteLength);
    expect(severityIndexFromHead(crowded.head)).toBe(1);

    holding.release();
    await holding.settled();
  });
});
