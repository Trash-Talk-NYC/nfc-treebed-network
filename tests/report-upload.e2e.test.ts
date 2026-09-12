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
import { signInByLink } from './helpers/steward-session';

// The seeded demo tag (tag-bindings.ts), bound to the seeded bed BED-HRL-0847.
const TAG = '2mq2amhv';
// Well-formed, and no binding speaks for it — the calm "not assigned" state.
const UNBOUND_TAG = '7zzzzzz0';
const BOUNDARY = '----treebede2e';
const MEGABYTE = 1024 * 1024;

/** The cap in report.ts plus the drain headroom in request-body.ts. */
const DRAIN_CEILING_BYTES = 12 * MEGABYTE + 24 * MEGABYTE;

let server: ChildProcessWithoutNullStreams;
let origin = '';
let port = 0;
let dataDir = '';
/** Everything the shared server has said on stderr, so far. */
let serverLog: () => string = () => '';

/**
 * Show the server's own account of a failure — including the
 * `[request-body]` lines that exist for exactly this. The stderr pipe is read
 * as it arrives either way, which a full one would otherwise block the server
 * on.
 */
function withServerLog(log: () => string = serverLog): void {
  onTestFailed(() => {
    const said = log();
    if (said) console.error(`--- server stderr ---\n${said}--- end ---`);
  });
}

interface Served {
  process: ChildProcessWithoutNullStreams;
  origin: string;
  port: number;
  dataDir: string;
  log: () => string;
}

/**
 * Start the built server on a port of its own, with a store of its own.
 *
 * `env` is how a test reaches a path that only opens under load: the in-flight
 * budget and the shed count are readable from the environment so the paths at
 * capacity can be driven with two sockets rather than several hundred.
 */
async function startServer(env: Record<string, string> = {}): Promise<Served> {
  const dir = await mkdtemp(path.join(tmpdir(), 'treebed-e2e-'));
  const child = spawn(process.execPath, ['dist/server/entry.mjs'], {
    env: {
      ...process.env,
      TREEBED_SESSION_SECRET: 'e2e-secret-not-a-real-one',
      TREEBED_DATA_DIR: dir,
      HOST: '127.0.0.1',
      PORT: '0',
      ...env,
    },
  }) as ChildProcessWithoutNullStreams;

  let log = '';
  child.stderr.on('data', (buf: Buffer) => {
    log += String(buf);
  });
  // A server that dies mid-suite otherwise says nothing at all: every later
  // test fails with ECONNREFUSED and the reason it went is lost.
  // This is here because it happened: on one dev machine the suite flaked 2 of
  // 7 runs, the spawned server vanishing right after the 200MB drain-ceiling
  // case with nothing on stderr; a standalone replay of the same uploads could
  // not reproduce it and 5 re-runs passed clean. Most likely an OS-level kill
  // under memory pressure — corroborated, not proven, by an unrelated
  // long-running process on the same machine being killed for low memory at
  // the same time. So the diagnostic stays and the ceiling stays where it is;
  // CI arbitrates.
  child.on('exit', (code, signal) => {
    log += `[e2e] server exited code=${code} signal=${signal}\n`;
  });

  const [url, listening] = await new Promise<[string, number]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server never reported a port')), 30_000);
    child.stdout.on('data', (buf: Buffer) => {
      const found = /(http:\/\/127\.0\.0\.1:(\d+))/.exec(String(buf));
      if (found) {
        clearTimeout(timer);
        resolve([found[1]!, Number(found[2])]);
      }
    });
    child.on('exit', (code) => reject(new Error(`server exited early (${code})\n${log}`)));
  });

  return { process: child, origin: url, port: listening, dataDir: dir, log: () => log };
}

/** What the server actually wrote for a report, out of its own store file. */
async function storedReport(
  id: string,
): Promise<{ categories: string[]; note: string; photoAttached: boolean }> {
  const data = JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8')) as {
    reports: Array<{ id: string; categories: string[]; note: string; photoAttached: boolean }>;
  };
  const found = data.reports.find((report) => report.id === id);
  if (!found) throw new Error(`no report ${id} in the store`);
  return found;
}

/** The newest report the server holds, however it got there. */
async function newestReport(): Promise<{ id: string; categories: string[]; photoAttached: boolean }> {
  const data = JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8')) as {
    reports: Array<{ id: string; categories: string[]; photoAttached: boolean; openedAt: string }>;
  };
  const sorted = [...data.reports].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const found = sorted[0];
  if (!found) throw new Error('the store holds no reports at all');
  return found;
}

/** Who the server recorded as confirming a report, out of its own store file. */
async function storedConfirmations(id: string): Promise<string[]> {
  const data = JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8')) as {
    reports: Array<{ id: string; confirmedBy: string[] }>;
  };
  return data.reports.find((report) => report.id === id)?.confirmedBy ?? [];
}

/** Whether a report is still open, out of the server's own store file. */
async function reportIsOpen(id: string): Promise<boolean> {
  const data = JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8')) as {
    reports: Array<{ id: string; closedAt: string | null }>;
  };
  return data.reports.find((report) => report.id === id)?.closedAt === null;
}

/**
 * The identity a neighbour standing at the tag has: the plaque GET mints it,
 * which is what the routes that decline to write for a cookie-less POST rely
 * on. Costs one tap, so take it before counting them.
 */
async function visitorCookie(): Promise<string> {
  const plaque = await fetch(`${origin}/t/${TAG}`);
  const set = plaque.headers.getSetCookie().find((cookie) => cookie.startsWith('tg_visitor='));
  if (!set) throw new Error('the plaque handed out no visitor cookie');
  return set.split(';')[0]!;
}

/**
 * The steward's identity. `/clear` is gated on a signed-in steward of this
 * bed, so closing a report goes through the sign-in the only clear button in
 * the build already sits behind: the emailed link, read out of the dev
 * outbox the server writes when no mail transport is configured. Memoized —
 * the session cookie lasts a year, and link requests are rate limited per
 * email, so asking once is also what a real steward does.
 */
let cachedStewardCookie: string | null = null;
async function stewardCookie(): Promise<string> {
  if (cachedStewardCookie) return cachedStewardCookie;
  cachedStewardCookie = await signInByLink(origin, dataDir, TAG);
  return cachedStewardCookie;
}

/** Close whatever report is open, the way the steward view's button does. */
async function clearAsSteward(): Promise<Response> {
  return fetch(`${origin}/t/${TAG}/clear`, {
    method: 'POST',
    headers: { origin, cookie: await stewardCookie() },
    redirect: 'manual',
  });
}

/** Applause events the server has actually written. */
async function storedApplause(): Promise<number> {
  const data = JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8')) as {
    events: Array<{ eventType: string }>;
  };
  return data.events.filter((event) => event.eventType === 'applause').length;
}

/** Tap events the server has actually written, out of its own store file. */
async function storedTaps(): Promise<number> {
  const data = JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8')) as {
    events: Array<{ eventType: string }>;
  };
  return data.events.filter((event) => event.eventType === 'tap').length;
}

/** The multipart preamble the care screen sends: category, then the file. */
function preamble(category: string): Buffer {
  return Buffer.from(
    `--${BOUNDARY}\r\n` +
      'Content-Disposition: form-data; name="category"\r\n\r\n' +
      `${category}\r\n` +
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
function writeBackpressured(socket: net.Socket, chunk: Buffer, waitMs = Infinity): Promise<boolean> {
  if (socket.write(chunk)) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    // A server that stops reading without closing leaves the socket full and
    // quiet: no drain, no error, no close. Waiting forever on that would hang
    // the run instead of failing it.
    const timer = Number.isFinite(waitMs) ? setTimeout(() => done(false), waitMs) : undefined;
    function done(drained: boolean): void {
      clearTimeout(timer);
      socket.off('drain', onDrain);
      socket.off('error', onEnd);
      socket.off('close', onEnd);
      resolve(drained);
    }
    const onDrain = (): void => done(true);
    const onEnd = (): void => done(false);
    socket.on('drain', onDrain);
    socket.on('error', onEnd);
    socket.on('close', onEnd);
  });
}

/** Which server to upload at, and how a real browser's connection differs. */
interface UploadTo {
  port?: number;
  /**
   * Send the request the way a browser does, with the connection left open.
   * `Connection: close` is a header Node itself acts on — it closes the socket
   * once the response is written, which would bound the ingress on its own and
   * hide whether the server bounds it.
   */
  keepAlive?: boolean;
  /** Stop writing after this long, so a server that never reads can't hang the test. */
  budgetMs?: number;
  /** Which tag to post at; the unbound one is refused before any rule runs. */
  tag?: string;
  /** Which page under the tag to post at. Every one of them has a body to bound. */
  page?: string;
  /** Which method to send it with. A route bounds only the one it exports. */
  method?: string;
}

/**
 * Upload a photo in paced chunks over a raw socket, so the client is still
 * writing when the server answers.
 */
async function slowUpload(
  category: string,
  photoBytes: number,
  chunkBytes: number,
  pauseMs: number,
  {
    port: target = port,
    keepAlive = false,
    budgetMs = Infinity,
    tag = TAG,
    page = 'report',
    method = 'POST',
  }: UploadTo = {},
): Promise<Upload> {
  const head = preamble(category);
  const length = head.byteLength + photoBytes + TRAILER.byteLength;
  const socket = net.connect(target, '127.0.0.1');
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
    `${method} /t/${tag}/${page} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${target}\r\n` +
      // Astro rejects cross-site form POSTs; a browser on the plaque sends this.
      `Origin: http://127.0.0.1:${target}\r\n` +
      `Content-Type: multipart/form-data; boundary=${BOUNDARY}\r\n` +
      `Content-Length: ${length}\r\n` +
      (keepAlive ? '\r\n' : 'Connection: close\r\n\r\n'),
  );
  socket.write(head);

  const chunk = Buffer.alloc(chunkBytes, 0x7f);
  const until = Date.now() + budgetMs;
  while (written < photoBytes && !dropped && Date.now() < until) {
    if (socket.destroyed) {
      dropped ??= 'socket destroyed';
      break;
    }
    const size = Math.min(chunkBytes, photoBytes - written);
    const drained = await writeBackpressured(socket, chunk.subarray(0, size), budgetMs);
    written += size;
    if (!drained) {
      // The socket took this chunk and then went nowhere: the server has
      // stopped reading, which for a refused upload is the whole point.
      dropped ??= socket.destroyed ? 'socket destroyed' : 'server stopped reading';
      break;
    }
    if (dropped || socket.destroyed) break;
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  if (!dropped && !socket.destroyed && written >= photoBytes) socket.write(TRAILER);
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
async function stalledUpload(category: string, sentBytes: number, waitMs: number): Promise<Upload> {
  const head = preamble(category);
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
    `POST /t/${TAG}/report HTTP/1.1\r\n` +
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

  const started = await startServer();
  server = started.process;
  origin = started.origin;
  port = started.port;
  dataDir = started.dataDir;
  serverLog = started.log;
}, 180_000);

afterAll(async () => {
  server?.kill();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe('oversized report uploads, end to end', () => {
  it('lets a 20MB photo finish and answers with the too-large screen', async () => {
    withServerLog();
    const upload = await slowUpload('guard', 20 * MEGABYTE, MEGABYTE, 20);

    // The refused body is drained, so the socket is still there to answer on.
    expect(upload.dropped).toBeNull();
    expect(upload.written).toBe(20 * MEGABYTE);
    expect(upload.status).toBe(303);
    expect(upload.location).toBe(`/t/${TAG}/too-large?category=guard`);

    const screen = await fetch(`${origin}${upload.location}`);
    expect(screen.status).toBe(200);
    const html = await screen.text();
    expect(html).toContain('That photo was too large.');
    // What they picked rode along, and one tap sends it without the photo.
    expect(html).toContain('Guard damage');
    expect(html).toContain('SEND IT WITHOUT THE PHOTO');
  });

  // 200MB is the measured number Node's own body dump reaches when the app
  // never touches the body; lowering it to calm a flaky dev machine would
  // quietly delete the proof. See the exit diagnostic in startServer above.
  it('drops a body that keeps streaming past the drain ceiling', async () => {
    withServerLog();
    const upload = await slowUpload('guard', 200 * MEGABYTE, 4 * MEGABYTE, 10);

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
    const upload = await stalledUpload('litter', 256 * 1024, 45_000);

    expect(upload.status).toBe(303);
    expect(upload.location).toBe(`/t/${TAG}/too-large?category=litter&reason=incomplete`);

    const screen = await fetch(`${origin}${upload.location}`);
    expect(screen.status).toBe(200);
    const html = await screen.text();
    expect(html).toContain('That upload didn&#39;t finish.');
    // Never blamed on the photo: this one may well have been under the cap.
    expect(html).not.toContain('That photo was too large.');
    expect(html).toContain('Litter');
    expect(html).toContain('SEND IT WITHOUT THE PHOTO');
  }, 120_000);

  it('still files a report a photo fits in, and records the attachment', async () => {
    withServerLog();
    const body = Buffer.concat([preamble('litter'), Buffer.alloc(64 * 1024, 0x7f), TRAILER]);
    const posted = await fetch(`${origin}/t/${TAG}/report`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, origin },
      body: new Uint8Array(body),
      redirect: 'manual',
    });
    expect(posted.status).toBe(303);
    // The approved flow ends on the thank-you takeover — no receipt.
    expect(posted.headers.get('location')).toBe(`/t/${TAG}/thanks`);

    // The fields come off the head now, never out of a buffered body — so the
    // category and the attachment have to survive that, not just the redirect.
    const filed = await newestReport();
    expect(filed.categories).toEqual(['litter']);
    expect(filed.photoAttached).toBe(true);
  });

  it('sends the too-large screen resend, which carries no photo at all', async () => {
    withServerLog();
    // The bed already has the report the previous case filed; its steward
    // closes it, and this is what the next passer-by's resend then does.
    const cleared = await clearAsSteward();
    expect(cleared.status).toBe(303);
    expect(cleared.headers.get('location')).toBe(`/t/${TAG}/mine`);

    const resent = await fetch(`${origin}/t/${TAG}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: 'category=guard&note=The+guard+is+bent.',
      redirect: 'manual',
    });
    expect(resent.status).toBe(303);
    expect(resent.headers.get('location')).toBe(`/t/${TAG}/thanks`);

    const filed = await storedReport((await newestReport()).id);
    expect(filed.categories).toEqual(['guard']);
    expect(filed.note).toBe('The guard is bent.');
    expect(filed.photoAttached).toBe(false);
  });

  it('has a screen for an upload refused because the server was full', async () => {
    withServerLog();
    // Where `refusal: 'busy'` sends a visitor: the same offer, never the same
    // words as a photo they were told to shrink.
    const screen = await fetch(`${origin}/t/${TAG}/too-large?category=litter&reason=busy`);
    expect(screen.status).toBe(200);
    const html = await screen.text();
    expect(html).toContain('The tag is busy right now.');
    expect(html).toContain('Litter');
    expect(html).toContain('SEND IT AGAIN');
    expect(html).not.toContain('That photo was too large.');

    // Past MAX_SHED_READS the body is never read, so there is no category to
    // carry — the deepest a spike goes, and still a screen rather than a reset.
    const bare = await fetch(`${origin}/t/${TAG}/too-large?reason=busy`);
    expect(bare.status).toBe(200);
    expect(await bare.text()).toContain('The tag is busy right now.');
  });

  it('counts one tap per visit, and none for its own redirects', async () => {
    withServerLog();
    // The bed still has the report the refile case filed; its guardian closes
    // it, which lands on the guardian view and logs no tap either way.
    expect((await clearAsSteward()).status).toBe(303);

    // A redirect of ours that does land on the plaque: a cookie-less applause
    // writes nothing and sends the caller back — one of the redirects that
    // used to land on the bare plaque and be counted as a second visit.
    const noop = await fetch(`${origin}/t/${TAG}/applause`, {
      method: 'POST',
      headers: { origin },
      redirect: 'manual',
    });
    expect(noop.status).toBe(303);
    const back = noop.headers.get('location');
    expect(back).toBe(`/t/${TAG}?tg_action=1`);

    const before = await storedTaps();
    const landed = await fetch(`${origin}${back}`);
    expect(landed.status).toBe(200);
    expect(await storedTaps()).toBe(before);

    // A decorated tag URL is still somebody at the tree bed.
    const tapped = await fetch(`${origin}/t/${TAG}?utm_source=popl&utm_medium=nfc`);
    expect(tapped.status).toBe(200);
    expect(await storedTaps()).toBe(before + 1);
  });

  it('counts applause only from a caller that already had an identity', async () => {
    withServerLog();
    // No cookie, so the server has nothing to hang "once a day per person" on:
    // minting one here would give a caller that discards cookies a fresh
    // identity per request, and the bound would bound nothing.
    const before = await storedApplause();
    for (let i = 0; i < 3; i += 1) {
      const posted = await fetch(`${origin}/t/${TAG}/applause`, {
        method: 'POST',
        headers: { origin },
        redirect: 'manual',
      });
      expect(posted.status).toBe(303);
      expect(posted.headers.get('location')).toBe(`/t/${TAG}?tg_action=1`);
    }
    expect(await storedApplause()).toBe(before);

    // A neighbour who tapped the tag has one — the door screen's GET set it —
    // and pressing the button twice the same day still counts them once.
    const cookie = await visitorCookie();
    for (let i = 0; i < 2; i += 1) {
      const posted = await fetch(`${origin}/t/${TAG}/applause`, {
        method: 'POST',
        headers: { origin, cookie },
        redirect: 'manual',
      });
      expect(posted.status).toBe(303);
      expect(posted.headers.get('location')).toBe(`/t/${TAG}/thanks?applause=1`);
    }
    expect(await storedApplause()).toBe(before + 1);
  });

  it('files a care report the way the screen does, and lands on the takeover', async () => {
    withServerLog();
    const filed = await fetch(`${origin}/t/${TAG}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: 'category=thirsty',
      redirect: 'manual',
    });
    expect(filed.status).toBe(303);
    expect(filed.headers.get('location')).toBe(`/t/${TAG}/thanks`);
    expect((await newestReport()).categories).toEqual(['thirsty']);

    // A second neighbour, on a bed that already has an open report, is not
    // shown a rule: same screen, and their weight lands on the open report
    // rather than opening a duplicate nobody could ever close.
    const second = await fetch(`${origin}/t/${TAG}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie: await visitorCookie() },
      body: 'category=litter',
      redirect: 'manual',
    });
    expect(second.status).toBe(303);
    expect(second.headers.get('location')).toBe(`/t/${TAG}/thanks`);
    const open = await newestReport();
    expect(open.categories).toEqual(['thirsty']);
    expect(await storedConfirmations(open.id)).toHaveLength(1);
  });

  it('sends an unpicked category back to the picker rather than a status code', async () => {
    withServerLog();
    const posted = await fetch(`${origin}/t/${TAG}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: 'category=',
      redirect: 'manual',
    });
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe(`/t/${TAG}/care?pick=1`);
  });

  it('writes nothing for an unauthenticated clear, and still answers', async () => {
    withServerLog();
    // The report the care case filed is still open, and /clear is what lets
    // the next one be filed: report → clear → report is a loop, and every lap
    // used to append a report and two events to a history nothing prunes. One
    // GET buys the visitor cookie, so only the steward gate ends it.
    const data = JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8')) as {
      reports: Array<{ id: string; closedAt: string | null }>;
      events: Array<{ eventType: string }>;
    };
    const open = data.reports.find((report) => report.closedAt === null)!;
    expect(open).toBeDefined();
    const clearsBefore = data.events.filter((event) => event.eventType === 'clear').length;

    for (let i = 0; i < 3; i += 1) {
      const posted = await fetch(`${origin}/t/${TAG}/clear`, {
        method: 'POST',
        headers: { origin },
        redirect: 'manual',
      });
      // Answered like any other no-op action — no reset, no error screen.
      expect(posted.status).toBe(303);
      expect(posted.headers.get('location')).toBe(`/t/${TAG}?tg_action=1`);
    }

    // And the cookie one door GET hands out is not a steward either, which
    // is the half a cookie gate alone missed: one GET, and the loop ran on.
    for (let i = 0; i < 3; i += 1) {
      const posted = await fetch(`${origin}/t/${TAG}/clear`, {
        method: 'POST',
        headers: { origin, cookie: await visitorCookie() },
        redirect: 'manual',
      });
      expect(posted.status).toBe(303);
      expect(posted.headers.get('location')).toBe(`/t/${TAG}?tg_action=1`);
    }
    expect(await reportIsOpen(open.id)).toBe(true);
    const after = JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8')) as {
      events: Array<{ eventType: string }>;
    };
    // Six POSTs, and not one of them wrote the event that would let the next
    // report be filed — which is the lap of the loop that had to stop.
    expect(after.events.filter((event) => event.eventType === 'clear').length).toBe(clearsBefore);

    // The bed's steward still closes it in one press.
    const cleared = await clearAsSteward();
    expect(cleared.status).toBe(303);
    expect(await reportIsOpen(open.id)).toBe(false);
  });

  it('does not count a monitor polling the site root as a tap', async () => {
    withServerLog();
    // Nothing on a sidewalk tag sends anyone to `/`, so what does is an uptime
    // check or a crawler — once a minute would be 1,440 taps a day.
    const before = await storedTaps();
    const root = await fetch(`${origin}/`, { redirect: 'manual' });
    expect(root.status).toBe(302);
    const landed = root.headers.get('location')!;
    expect(landed).toBe(`/t/${TAG}?tg_action=1`);
    expect((await fetch(`${origin}${landed}`)).status).toBe(200);
    expect(await storedTaps()).toBe(before);
  });

  it('refuses an oversized sign-in body without reading a megabyte of it', async () => {
    withServerLog();
    const posted = await fetch(`${origin}/t/${TAG}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: `email=${'a'.repeat(200 * 1024)}%40example.com`,
      redirect: 'manual',
    });
    expect(posted.status).toBe(413);
    expect(await posted.text()).toContain('too large');
  });
});

describe('the passwordless surface', () => {
  // A server of its own: these cases adopt a steward and spend sign-in link
  // requests, and the shared server's counts must not absorb either.
  let full: Served;

  beforeAll(async () => {
    full = await startServer();
  }, 60_000);

  afterAll(async () => {
    full?.process.kill();
    if (full?.dataDir) await rm(full.dataDir, { recursive: true, force: true });
  });

  it('never renders a password, PIN or code field on the adopt form', async () => {
    withServerLog(() => full.log());
    // The captain ordered the field dropped. This is the assertion that keeps
    // it dropped, in both languages, rather than a comment saying so.
    for (const lang of ['en', 'es']) {
      const html = await (await fetch(`${full.origin}/t/${TAG}/adopt?lang=${lang}`)).text();
      expect(html).not.toContain('type="password"');
      expect(html).not.toContain('name="pin"');
      expect(html).not.toContain('name="username"');
      expect(html).toContain('name="firstName"');
      expect(html).toContain('name="lastName"');
      expect(html).toContain('name="email"');
    }
  }, 60_000);

  it('takes an adoption and stores no secret, only the emailed sign-in route', async () => {
    withServerLog(() => full.log());
    const posted = await fetch(`${full.origin}/t/${TAG}/adopt?lang=es`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: full.origin },
      body: 'firstName=Rita&lastName=Okafor&email=r.okafor%40example.com&phone=%2B1+555+010+1234',
      redirect: 'manual',
    });

    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe(`/t/${TAG}/adopted?lang=es`);
    // The session cookie is what carries them from here; the emailed link is
    // the way back in after it is lost.
    expect(posted.headers.getSetCookie().some((c) => c.startsWith('tg_session='))).toBe(true);

    const data = JSON.parse(await readFile(path.join(full.dataDir, 'store.json'), 'utf8')) as {
      users: Record<
        string,
        { username: string; hasSignInRoute: boolean; lang: string } & Record<string, unknown>
      >;
    };
    const rita = Object.values(data.users).find((u) => u.username === 'rita_o');
    // The handle is derived from the name — nobody typed one.
    expect(rita).toBeDefined();
    // No secret was stored, because none was collected — and the email IS
    // the sign-in route now.
    expect(rita?.pinHash).toBeUndefined();
    expect(rita?.hasSignInRoute).toBe(true);
    // The language the screen spoke rode onto the record, for the digest.
    expect(rita?.lang).toBe('es');
  }, 60_000);

  it('hands the sign-in form back with the email in it when rate limited', async () => {
    withServerLog(() => full.log());
    const ask = () =>
      fetch(`${full.origin}/t/${TAG}/auth`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: full.origin },
        body: 'email=somebody%40example.com',
        redirect: 'manual',
      });
    // The per-email cap is 3 per window (service.ts); the fourth is refused
    // with the form intact — a retry, not a dead end — and the same answer
    // whether or not the address is anybody's.
    for (let i = 0; i < 3; i += 1) expect((await ask()).status).toBe(303);
    const refused = await ask();
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('600');
    const html = await refused.text();
    expect(html).toContain('value="somebody@example.com"');
    // Both languages ride in the markup, so the toggle is instant and the
    // server render is already right with no script at all.
    expect(html).toContain('data-es="ENVÍAME UN ENLACE"');
  }, 60_000);
});

describe('an upload that arrives past the shed count', () => {
  // The deepest branch in request-body.ts: no room in the byte budget and no
  // shed slot left either, where the read keeps nothing at all. Driven with a
  // server whose two bounds are set to zero, because reaching it honestly takes
  // several hundred concurrent uploads and proves nothing extra.
  //
  // Worth a real socket rather than a unit test twice over. A body the app
  // never reads is not a body the server never receives: Node dumps it, which
  // measured at the full 200MB — bounded by nothing but its own 300s timeout —
  // and no synthetic ReadableStream can show that, because the dump lives in
  // Node's HTTP server, not in the stream. And the answer still has to reach
  // the visitor over a socket that is still there, which is the exact thing an
  // earlier version of this file got wrong.
  let shed: Served;

  beforeAll(async () => {
    shed = await startServer({
      TREEBED_MAX_INFLIGHT_BODY_BYTES: '0',
      TREEBED_MAX_SHED_READS: '0',
    });
  }, 60_000);

  afterAll(async () => {
    shed?.process.kill();
    if (shed?.dataDir) await rm(shed.dataDir, { recursive: true, force: true });
  });

  it('answers a 200MB body after taking kilobytes of it', async () => {
    withServerLog(() => shed.log());
    // Keep-alive, like a browser: `Connection: close` would have Node end the
    // socket for us and prove nothing about what this code bounds.
    const upload = await slowUpload('guard', 200 * MEGABYTE, 4 * MEGABYTE, 10, {
      port: shed.port,
      keepAlive: true,
      budgetMs: 20_000,
    });

    // The screen, on a live socket — never a reset in place of an answer.
    expect(upload.status).toBe(303);
    // Declared over the cap as well as unroomed, and the size is what it is
    // told: "the tag is busy" would send it to retry the same photo forever.
    // No head was kept at this depth, so nothing they picked rides along.
    expect(upload.location).toBe(`/t/${TAG}/too-large`);
    // And the ingress stopped where we say it does, not where the sender does.
    // Left untouched instead, this body is one Node reads to its end for us.
    expect(upload.written).toBeLessThan(16 * MEGABYTE);

    const screen = await fetch(`${shed.origin}${upload.location}`);
    expect(screen.status).toBe(200);
    const html = await screen.text();
    expect(html).toContain('That photo was too large.');
    expect(html).toContain('PICK IT AGAIN');
  }, 60_000);

  it('says the tag is busy when the body itself was never the problem', async () => {
    withServerLog(() => shed.log());
    const body = Buffer.concat([preamble('litter'), Buffer.alloc(16 * 1024, 0x7f), TRAILER]);
    const posted = await fetch(`${shed.origin}/t/${TAG}/report`, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
        origin: shed.origin,
      },
      body: new Uint8Array(body),
      redirect: 'manual',
    });

    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe(`/t/${TAG}/too-large?reason=busy`);
    const screen = await fetch(`${shed.origin}/t/${TAG}/too-large?reason=busy`);
    expect(await screen.text()).toContain('The tag is busy right now.');
  }, 60_000);
});

describe('the tag URL, end to end', () => {
  // The URL on the chip is an opaque tag ID; the bed's plate is display text.
  // These prove the two decisions the re-key exists for: a mistyped ID still
  // resolves, and a tag nobody has bound yet is a calm page, never a 500.

  it('redirects a mistyped tag to the canonical URL, decoration intact', async () => {
    withServerLog();
    // Uppercase, a legibility hyphen, and a decorated query string — the way
    // an ID typed off a sign actually arrives.
    const typed = await fetch(`${origin}/t/2MQ2-AMHV?utm_source=popl`, { redirect: 'manual' });
    expect(typed.status).toBe(302);
    expect(typed.headers.get('location')).toBe(`/t/${TAG}?utm_source=popl`);
    expect((await fetch(`${origin}${typed.headers.get('location')}`)).status).toBe(200);
  });

  it('answers an unbound tag with a calm page, not a 500', async () => {
    withServerLog();
    // A freshly-encoded tag nobody has bound: a normal state — tags go into
    // the wood before their guard exists. 404 because there is no site here,
    // but the page is the honest answer, with the ID on it.
    const unbound = await fetch(`${origin}/t/${UNBOUND_TAG}`);
    expect(unbound.status).toBe(404);
    const html = await unbound.text();
    expect(html).toContain(UNBOUND_TAG);
    expect(html).toContain('assigned to a bed yet');
  });

  it('sends a sub-page at an unbound tag to the calm plaque screen', async () => {
    withServerLog();
    // A page bookmarked before the tag was retired, or tapped between the tap
    // and the button: an unbound tag is a normal state everywhere, not a line
    // of unstyled text on the screens below the plaque.
    for (const page of ['adopt', 'auth', 'mine', 'care', 'thanks', 'adopted', 'too-large']) {
      const sub = await fetch(`${origin}/t/${UNBOUND_TAG}/${page}`, { redirect: 'manual' });
      expect(sub.status).toBe(302);
      expect(sub.headers.get('location')).toBe(`/t/${UNBOUND_TAG}`);
    }
  });

  it('refuses a POST at an unbound tag, and takes kilobytes of its body doing it', async () => {
    withServerLog();
    // Refused before any rule runs — but a body the app never touches is not a
    // body the server never receives: Node dumps an unconsumed one to its end.
    // So this is measured over a socket that is still writing, the same way the
    // shed path is, because a status code alone cannot tell the two apart.
    const upload = await slowUpload('litter', 200 * MEGABYTE, 4 * MEGABYTE, 10, {
      keepAlive: true,
      budgetMs: 20_000,
      tag: UNBOUND_TAG,
    });

    expect(upload.status).toBe(404);
    expect(upload.written).toBeLessThan(16 * MEGABYTE);
  }, 60_000);

  it('takes kilobytes of a POST at an unbound tag on the form screens too', async () => {
    withServerLog();
    // `adopt` and `auth` answer a POST as well, and they refuse an unbound tag
    // with the plaque redirect rather than the API routes' 404 — the same
    // unread body either way, so the same bound has to be on it. 303 rather
    // than 302 because this one answers a POST: a 302 invites a client that
    // reads the spec to repeat the body at the plaque, the one screen that
    // logs a tap.
    for (const page of ['adopt', 'auth']) {
      const upload = await slowUpload('litter', 200 * MEGABYTE, 4 * MEGABYTE, 10, {
        keepAlive: true,
        budgetMs: 20_000,
        tag: UNBOUND_TAG,
        page,
      });

      expect(upload.status).toBe(303);
      expect(upload.location).toBe(`/t/${UNBOUND_TAG}`);
      expect(upload.written).toBeLessThan(16 * MEGABYTE);
    }
  }, 120_000);

  it('takes kilobytes of a POST at the screens that have no form on them', async () => {
    withServerLog();
    // Astro renders a page for a POST as readily as for a tap, so the plaque,
    // the guardian view, the too-large screen and the receipt all answer one —
    // and an answer given without touching the body leaves Node to read it to
    // the end. Bound tag, so nothing refuses these on the way in.
    for (const page of ['', 'mine', 'too-large', 'receipt/r_nope']) {
      const upload = await slowUpload('litter', 200 * MEGABYTE, 4 * MEGABYTE, 10, {
        keepAlive: true,
        budgetMs: 20_000,
        page,
      });

      expect(upload.status).not.toBeNull();
      expect(upload.written).toBeLessThan(16 * MEGABYTE);
    }
  }, 120_000);

  it('takes kilobytes of a request whose method the route does not handle', async () => {
    withServerLog();
    // A route bounds only the method it exports: everything else is answered
    // by the framework, or rendered as a page, without the body being touched
    // — and an untouched body is one Node reads to its end for us. The drain
    // in src/middleware.ts is the backstop for all of them, so it is measured
    // on an endpoint (405 from `postOnly`) and on a page (rendered) alike.
    for (const page of ['report', 'applause', '']) {
      const upload = await slowUpload('litter', 200 * MEGABYTE, 4 * MEGABYTE, 10, {
        keepAlive: true,
        budgetMs: 20_000,
        method: 'PUT',
        page,
      });

      expect(upload.status).not.toBeNull();
      expect(upload.written).toBeLessThan(16 * MEGABYTE);
    }
  }, 120_000);

  it('answers an unhandled method on a POST route with 405 rather than 404', async () => {
    // Astro's own fallback logs a line per request, which would let an
    // anonymous caller decide how much stderr it costs us. Same-origin, or the
    // framework's own cross-origin guard answers 403 ahead of the route.
    const answered = await fetch(`${origin}/t/${TAG}/applause`, {
      method: 'DELETE',
      headers: { origin },
    });
    expect(answered.status).toBe(405);
    expect(answered.headers.get('allow')).toBe('POST');
  });

  it('serves nothing at the old plate-keyed route', async () => {
    withServerLog();
    // The plate encodes site type and neighbourhood, which the tag URL must
    // not carry — and it is not a near-miss the tag route should guess at.
    expect((await fetch(`${origin}/b/BED-HRL-0847`)).status).toBe(404);
    expect((await fetch(`${origin}/t/BED-HRL-0847`)).status).toBe(404);
  });
});
