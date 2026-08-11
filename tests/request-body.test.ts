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
