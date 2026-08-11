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

/** A streamed request, so cancelling vs. draining the body is observable. */
function streamedRequest(body: Buffer, chunkBytes: number) {
  let cancelled = false;
  let delivered = 0;
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
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

  it('hangs up on a body that keeps streaming far past the cap', async () => {
    const { req, wasCancelled, deliveredBytes } = streamedRequest(
      reportBody('0', 2 * 1024 * 1024),
      16 * 1024,
    );
    const capped = await readCappedBody(req, 64 * 1024);
    expect(capped.body).toBeNull();
    expect(wasCancelled()).toBe(true);
    // Dropped once it passed 8× the cap — not after the whole 2MB.
    expect(deliveredBytes()).toBeLessThan(1024 * 1024);
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
