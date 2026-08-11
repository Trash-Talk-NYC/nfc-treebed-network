// The oversized-upload path, proven against a real server over a real socket.
//
// Unit tests can show that the read drains instead of cancelling, but not that
// the visitor gets the screen — and that is exactly where an earlier version
// of this fix broke: it read correctly and the client still got a connection
// reset. So this builds the app, starts `dist/server/entry.mjs`, and uploads at
// it slowly, the way a phone on the sidewalk does. Speed is the whole point of
// the slow writes: a client that has already handed its whole body to the
// kernel gets the response either way, so a fast loopback POST cannot tell a
// drained body from a destroyed socket.
//
// Slow by nature (a build plus a server), which is why `npm test` excludes it
// and `npm run test:e2e` runs it.

import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest';
import net from 'node:net';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PLATE = 'BED-HRL-0847';
const BOUNDARY = '----treebede2e';
const MEGABYTE = 1024 * 1024;

/** The cap in report.ts plus the drain headroom in request-body.ts. */
const DRAIN_CEILING_BYTES = 12 * MEGABYTE + 24 * MEGABYTE;

let server: ChildProcessWithoutNullStreams;
let origin = '';
let port = 0;
let dataDir = '';
/** Everything the server said on stderr, printed when an assertion fails. */
let serverLog = '';

/**
 * Show the server's own account of a failure — including the
 * `[request-body]` lines that exist for exactly this — and keep the stderr
 * pipe drained, which a full one would otherwise block the server on.
 */
function withServerLog(): void {
  onTestFailed(() => {
    if (serverLog) console.error(`--- server stderr ---\n${serverLog}--- end ---`);
  });
}

/** What the server actually wrote for a report, out of its own store file. */
async function storedReport(id: string): Promise<{ severity: string; photoAttached: boolean }> {
  const data = JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8')) as {
    reports: Array<{ id: string; severity: string; photoAttached: boolean }>;
  };
  const found = data.reports.find((report) => report.id === id);
  if (!found) throw new Error(`no report ${id} in the store`);
  return found;
}

/** Who the server recorded as confirming a report, out of its own store file. */
async function storedConfirmations(id: string): Promise<string[]> {
  const data = JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8')) as {
    reports: Array<{ id: string; confirmedBy: string[] }>;
  };
  return data.reports.find((report) => report.id === id)?.confirmedBy ?? [];
}

/** Tap events the server has actually written, out of its own store file. */
async function storedTaps(): Promise<number> {
  const data = JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8')) as {
    events: Array<{ eventType: string }>;
  };
  return data.events.filter((event) => event.eventType === 'tap').length;
}

/** The multipart preamble the severity sheet sends: severity, then the file. */
function preamble(severityIndex: string): Buffer {
  return Buffer.from(
    `--${BOUNDARY}\r\n` +
      'Content-Disposition: form-data; name="severity"\r\n\r\n' +
      `${severityIndex}\r\n` +
      `--${BOUNDARY}\r\n` +
      'Content-Disposition: form-data; name="photo"; filename="tree.jpg"\r\n' +
      'Content-Type: image/jpeg\r\n\r\n',
  );
}

const TRAILER = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);

interface Upload {
  /** Bytes of photo the socket accepted before the client was cut off. */
  written: number;
  /** Set when the server dropped the connection mid-upload. */
  dropped: string | null;
  status: number | null;
  location: string | null;
}

/**
 * Write and wait for the socket to be ready for more.
 *
 * Ignoring `write()`'s return value would buffer megabytes in userland no
 * matter what the server reads, which makes `written` a measure of this
 * process's memory rather than of the server's ingress — and any assertion on
 * it a race against the event loop.
 */
function writeBackpressured(socket: net.Socket, chunk: Buffer): Promise<void> {
  if (socket.write(chunk)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = (): void => {
      socket.off('drain', done);
      socket.off('error', done);
      socket.off('close', done);
      resolve();
    };
    socket.on('drain', done);
    socket.on('error', done);
    socket.on('close', done);
  });
}

/**
 * Upload a photo in paced chunks over a raw socket, so the client is still
 * writing when the server answers.
 */
async function slowUpload(
  severity: string,
  photoBytes: number,
  chunkBytes: number,
  pauseMs: number,
): Promise<Upload> {
  const head = preamble(severity);
  const length = head.byteLength + photoBytes + TRAILER.byteLength;
  const socket = net.connect(port, '127.0.0.1');
  let response = '';
  let dropped: string | null = null;
  let written = 0;

  socket.on('data', (data: Buffer) => {
    response += data.toString('latin1');
  });
  socket.on('error', (err: NodeJS.ErrnoException) => {
    dropped ??= err.code ?? err.message;
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  socket.write(
    `POST /b/${PLATE}/report HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${port}\r\n` +
      // Astro rejects cross-site form POSTs; a browser on the plaque sends this.
      `Origin: http://127.0.0.1:${port}\r\n` +
      `Content-Type: multipart/form-data; boundary=${BOUNDARY}\r\n` +
      `Content-Length: ${length}\r\n` +
      'Connection: close\r\n\r\n',
  );
  socket.write(head);

  const chunk = Buffer.alloc(chunkBytes, 0x7f);
  while (written < photoBytes && !dropped) {
    if (socket.destroyed) {
      dropped ??= 'socket destroyed';
      break;
    }
    const size = Math.min(chunkBytes, photoBytes - written);
    await writeBackpressured(socket, chunk.subarray(0, size));
    if (dropped || socket.destroyed) break;
    written += size;
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  if (!dropped && !socket.destroyed) socket.write(TRAILER);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  socket.destroy();

  return {
    written,
    dropped,
    status: Number(/^HTTP\/1\.1 (\d{3})/.exec(response)?.[1]) || null,
    location: /location: (\S+)/i.exec(response)?.[1] ?? null,
  };
}

/**
 * Start an upload the server would accept, then go quiet — a phone that walked
 * out of signal halfway through. Nothing declares this body oversized; only
 * the accepted path's own idle bound ends it.
 */
async function stalledUpload(severity: string, sentBytes: number, waitMs: number): Promise<Upload> {
  const head = preamble(severity);
  // Under the 12MB cap, so this is never an oversized body — just an unfinished one.
  const length = head.byteLength + 4 * MEGABYTE + TRAILER.byteLength;
  const socket = net.connect(port, '127.0.0.1');
  let response = '';
  let dropped: string | null = null;

  socket.on('data', (data: Buffer) => {
    response += data.toString('latin1');
  });
  socket.on('error', (err: NodeJS.ErrnoException) => {
    dropped ??= err.code ?? err.message;
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  socket.write(
    `POST /b/${PLATE}/report HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${port}\r\n` +
      `Origin: http://127.0.0.1:${port}\r\n` +
      `Content-Type: multipart/form-data; boundary=${BOUNDARY}\r\n` +
      `Content-Length: ${length}\r\n` +
      'Connection: close\r\n\r\n',
  );
  socket.write(head);
  await writeBackpressured(socket, Buffer.alloc(sentBytes, 0x7f));

  // …and then nothing at all, until the server gives up on the rest.
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  socket.destroy();

  return {
    written: sentBytes,
    dropped,
    status: Number(/^HTTP\/1\.1 (\d{3})/.exec(response)?.[1]) || null,
    location: /location: (\S+)/i.exec(response)?.[1] ?? null,
  };
}

beforeAll(async () => {
  const built = spawnSync('npm', ['run', 'build'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (built.status !== 0) throw new Error(`build failed:\n${built.stdout}\n${built.stderr}`);

  dataDir = await mkdtemp(path.join(tmpdir(), 'treebed-e2e-'));
  server = spawn(process.execPath, ['dist/server/entry.mjs'], {
    env: {
      ...process.env,
      TREEBED_SESSION_SECRET: 'e2e-secret-not-a-real-one',
      TREEBED_DATA_DIR: dataDir,
      HOST: '127.0.0.1',
      PORT: '0',
    },
  }) as ChildProcessWithoutNullStreams;
  server.stderr.on('data', (buf: Buffer) => {
    serverLog += String(buf);
  });

  origin = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server never reported a port')), 30_000);
    server.stdout.on('data', (buf: Buffer) => {
      const found = /(http:\/\/127\.0\.0\.1:(\d+))/.exec(String(buf));
      if (found) {
        clearTimeout(timer);
        port = Number(found[2]);
        resolve(found[1]!);
      }
    });
    server.on('exit', (code) => reject(new Error(`server exited early (${code})\n${serverLog}`)));
  });
}, 180_000);

afterAll(async () => {
  server?.kill();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe('oversized report uploads, end to end', () => {
  it('lets a 20MB photo finish and answers with the too-large screen', async () => {
    withServerLog();
    const upload = await slowUpload('2', 20 * MEGABYTE, MEGABYTE, 20);

    // The refused body is drained, so the socket is still there to answer on.
    expect(upload.dropped).toBeNull();
    expect(upload.written).toBe(20 * MEGABYTE);
    expect(upload.status).toBe(303);
    expect(upload.location).toBe(`/b/${PLATE}/too-large?severity=2`);

    const screen = await fetch(`${origin}${upload.location}`);
    expect(screen.status).toBe(200);
    const html = await screen.text();
    expect(html).toContain('That photo was too large.');
    // The severity they picked rode along, and one tap files without the photo.
    expect(html).toContain('DUMPING');
    expect(html).toContain('FILE IT WITHOUT THE PHOTO');
  });

  it('drops a body that keeps streaming past the drain ceiling', async () => {
    withServerLog();
    const upload = await slowUpload('2', 200 * MEGABYTE, 4 * MEGABYTE, 10);

    expect(upload.dropped).not.toBeNull();
    // Loose on purpose: what matters is that 200MB of ingress was never on
    // offer for one refused POST, not the exact byte the read stopped at.
    // The client honours backpressure, so this counts bytes the socket took,
    // but the kernel's own buffers still sit past the server's last read.
    expect(upload.written).toBeLessThan(DRAIN_CEILING_BYTES + 24 * MEGABYTE);
  });

  it('keeps the report of an upload that stalled under the cap', async () => {
    withServerLog();
    // Slow by construction: the server waits READ_IDLE_MS (30s) before calling
    // a quiet sender finished, and shortening that would test a bound nobody
    // ships. A body under the cap that never all arrives is the likelier
    // failure on a sidewalk than exceeding 12MB, and the standing ruling is
    // that neither one costs somebody the report they already filled in.
    const upload = await stalledUpload('1', 256 * 1024, 45_000);

    expect(upload.status).toBe(303);
    expect(upload.location).toBe(`/b/${PLATE}/too-large?severity=1&reason=incomplete`);

    const screen = await fetch(`${origin}${upload.location}`);
    expect(screen.status).toBe(200);
    const html = await screen.text();
    expect(html).toContain('That upload didn&#39;t finish.');
    // Never blamed on the photo: this one may well have been under the cap.
    expect(html).not.toContain('That photo was too large.');
    expect(html).toContain('HEAVY');
    expect(html).toContain('FILE IT WITHOUT THE PHOTO');
  }, 120_000);

  it('still files a report a photo fits in, and records the attachment', async () => {
    withServerLog();
    const body = Buffer.concat([preamble('1'), Buffer.alloc(64 * 1024, 0x7f), TRAILER]);
    const posted = await fetch(`${origin}/b/${PLATE}/report`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, origin },
      body: new Uint8Array(body),
      redirect: 'manual',
    });
    expect(posted.status).toBe(303);
    const location = posted.headers.get('location');
    expect(location).toMatch(new RegExp(`^/b/${PLATE}/receipt/`));

    // The fields come off the head now, never out of a buffered body — so the
    // severity and the attachment have to survive that, not just the redirect.
    const filed = await storedReport(location!.split('/').at(-1)!);
    expect(filed.severity).toBe('heavy');
    expect(filed.photoAttached).toBe(true);
  });

  it('files the too-large screen refile, which carries no photo at all', async () => {
    withServerLog();
    // The bed already has the report the previous case filed; anyone may clear
    // it (spec §2), and this is what the next passer-by's refile then does.
    const cleared = await fetch(`${origin}/b/${PLATE}/clear`, {
      method: 'POST',
      headers: { origin },
      redirect: 'manual',
    });
    expect(cleared.status).toBe(303);

    const refiled = await fetch(`${origin}/b/${PLATE}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: 'severity=2',
      redirect: 'manual',
    });
    expect(refiled.status).toBe(303);
    const location = refiled.headers.get('location');
    expect(location).toMatch(new RegExp(`^/b/${PLATE}/receipt/`));

    const filed = await storedReport(location!.split('/').at(-1)!);
    expect(filed.severity).toBe('dumping');
    expect(filed.photoAttached).toBe(false);
  });

  it('has a screen for an upload refused because the server was full', async () => {
    withServerLog();
    // Where `refusal: 'busy'` sends a visitor: the same offer, never the same
    // words as a photo they were told to shrink.
    const screen = await fetch(`${origin}/b/${PLATE}/too-large?severity=1&reason=busy`);
    expect(screen.status).toBe(200);
    const html = await screen.text();
    expect(html).toContain('The tag is busy right now.');
    expect(html).toContain('HEAVY');
    expect(html).toContain('SEND IT AGAIN');
    expect(html).not.toContain('That photo was too large.');

    // Past MAX_SHED_READS the body is never read, so there is no severity to
    // carry — the deepest a spike goes, and still a screen rather than a reset.
    const bare = await fetch(`${origin}/b/${PLATE}/too-large?reason=busy`);
    expect(bare.status).toBe(200);
    expect(await bare.text()).toContain('The tag is busy right now.');
  });

  it('counts one tap per visit, and none for its own redirects', async () => {
    withServerLog();
    // The bed still has the report the refile case filed; closing it is one of
    // the redirects that used to land on the bare plaque and be counted twice.
    const cleared = await fetch(`${origin}/b/${PLATE}/clear`, {
      method: 'POST',
      headers: { origin },
      redirect: 'manual',
    });
    expect(cleared.status).toBe(303);
    const back = cleared.headers.get('location');
    expect(back).toBe(`/b/${PLATE}?tg_action=1`);

    const before = await storedTaps();
    const landed = await fetch(`${origin}${back}`);
    expect(landed.status).toBe(200);
    expect(await storedTaps()).toBe(before);

    // A decorated tag URL is still somebody at the tree bed.
    const tapped = await fetch(`${origin}/b/${PLATE}?utm_source=popl&utm_medium=nfc`);
    expect(tapped.status).toBe(200);
    expect(await storedTaps()).toBe(before + 1);
  });

  it('counts a confirm only from a caller that already had an identity', async () => {
    withServerLog();
    const filed = await fetch(`${origin}/b/${PLATE}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: 'severity=1',
      redirect: 'manual',
    });
    expect(filed.status).toBe(303);
    const id = filed.headers.get('location')!.split('/').at(-1)!;

    // No cookie, so the server has nothing to hang "once per person" on: it
    // used to mint a fresh identity per request, which let a loop like this
    // one drive the public count as high as it liked.
    for (let i = 0; i < 3; i += 1) {
      const posted = await fetch(`${origin}/b/${PLATE}/confirm`, {
        method: 'POST',
        headers: { origin },
        redirect: 'manual',
      });
      expect(posted.status).toBe(303);
      expect(posted.headers.get('location')).toBe(`/b/${PLATE}?tg_action=1`);
    }
    expect(await storedConfirmations(id)).toHaveLength(0);

    // A neighbour who tapped the tag has one — the plaque GET set it — and
    // pressing the button twice still counts them once.
    const plaque = await fetch(`${origin}/b/${PLATE}`);
    const visitor = plaque.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('tg_visitor='))!;
    expect(visitor).toBeDefined();
    const cookie = visitor.split(';')[0]!;
    for (let i = 0; i < 2; i += 1) {
      const posted = await fetch(`${origin}/b/${PLATE}/confirm`, {
        method: 'POST',
        headers: { origin, cookie },
        redirect: 'manual',
      });
      expect(posted.status).toBe(303);
      expect(posted.headers.get('location')).toBe(`/b/${PLATE}?confirmed=1`);
    }
    expect(await storedConfirmations(id)).toHaveLength(1);
  });

  it('refuses an oversized sign-in body without reading a megabyte of it', async () => {
    withServerLog();
    const posted = await fetch(`${origin}/b/${PLATE}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: `username=${'a'.repeat(200 * 1024)}&pin=1234`,
      redirect: 'manual',
    });
    expect(posted.status).toBe(413);
    expect(await posted.text()).toContain('too large');
  });
});
