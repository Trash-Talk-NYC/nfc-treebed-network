import { describe, expect, it } from 'vitest';
import { readCappedBody, severityIndexFromHead } from '../src/lib/request-body';

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
