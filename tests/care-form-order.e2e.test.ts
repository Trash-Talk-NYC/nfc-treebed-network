// The care form's part order, proven against the markup the screen actually
// renders.
//
// `report.ts` never buffers a multipart body: the category, the note and the
// attachment are read off the first `HEAD_BYTES` (`textFieldFromHead`), which
// only works while the text fields sit ahead of the file input in the DOM,
// because browsers send parts in that order. Comments say so in three places
// and so does AGENTS.md, and none of them would fail if somebody moved the
// photo row up the screen — the report would still be accepted and the visitor
// would still get the thank-you takeover, with what they told us silently
// gone.
//
// So this suite does not hand-build a body the way the test author imagines
// the form to be shaped. It fetches `/t/<tag>/care` and `/t/<tag>/care?tell=1`
// from the running server, reads the fields out of the rendered `<form>` in
// their real order, and posts exactly that. Reorder the markup and these go
// red. The two "reordered" cases are the control that says so: the same parts
// with the photo moved first, which must not file anything.
//
// Slow by nature (a build plus a server), so it lives in the e2e suite.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** The seeded demo tag (tag-bindings.ts), bound to the seeded bed BED-HRL-0847. */
const TAG = '2mq2amhv';
const BOUNDARY = '----treebedcareorder';
/** Comfortably past `HEAD_BYTES` (8KB), the way a phone photo is. */
const PHOTO_BYTES = 64 * 1024;

let server: ChildProcessWithoutNullStreams;
let origin = '';
let dataDir = '';

beforeAll(async () => {
  const built = spawnSync('npm', ['run', 'build'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (built.status !== 0) throw new Error(`build failed:\n${built.stdout}\n${built.stderr}`);

  dataDir = await mkdtemp(path.join(tmpdir(), 'treebed-care-order-'));
  const child = spawn(process.execPath, ['dist/server/entry.mjs'], {
    env: {
      ...process.env,
      TREEBED_SESSION_SECRET: 'e2e-secret-not-a-real-one',
      TREEBED_DATA_DIR: dataDir,
      HOST: '127.0.0.1',
      PORT: '0',
    },
  }) as ChildProcessWithoutNullStreams;
  let log = '';
  child.stderr.on('data', (buf: Buffer) => {
    log += String(buf);
  });
  origin = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server never reported a port')), 30_000);
    child.stdout.on('data', (buf: Buffer) => {
      const found = /(http:\/\/127\.0\.0\.1:\d+)/.exec(String(buf));
      if (found) {
        clearTimeout(timer);
        resolve(found[1]!);
      }
    });
    child.on('exit', (code) => reject(new Error(`server exited early (${code})\n${log}`)));
  });
  server = child;
}, 180_000);

afterAll(async () => {
  server?.kill();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

interface StoredReport {
  id: string;
  category: string;
  note: string;
  photoAttached: boolean;
  openedAt: string;
}

/** Every report the server has actually written, out of its own store file. */
async function storedReports(): Promise<StoredReport[]> {
  const data = JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8')) as {
    reports: StoredReport[];
  };
  return data.reports;
}

/** The newest report the server holds, however it got there. */
async function newestReport(): Promise<StoredReport> {
  const sorted = [...(await storedReports())].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const found = sorted[0];
  if (!found) throw new Error('the store holds no reports at all');
  return found;
}

/**
 * Close whatever report is open, the way the steward view's button does. Only
 * one report is open per bed at a time, so each case files its own by clearing
 * the last one first — a second send would ride the open report as weight
 * instead.
 */
async function clearAsSteward(): Promise<void> {
  const posted = await fetch(`${origin}/t/${TAG}/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: 'username=marisol_r&pin=1234',
    redirect: 'manual',
  });
  const session = posted.headers.getSetCookie().find((cookie) => cookie.startsWith('tg_session='));
  if (!session) throw new Error(`sign-in handed out no session cookie (${posted.status})`);
  const cleared = await fetch(`${origin}/t/${TAG}/clear`, {
    method: 'POST',
    headers: { origin, cookie: session.split(';')[0]! },
    redirect: 'manual',
  });
  if (cleared.status !== 303) throw new Error(`clear answered ${cleared.status}`);
}

/** One part of a multipart body, as the rendered form would send it. */
interface Part {
  name: string;
  /** A file part when set — the photo, which is what pushes past the head. */
  filename?: string;
  value: string | Uint8Array;
}

/** What the screen renders, reduced to the fields a browser would submit. */
interface RenderedForm {
  action: string;
  parts: Part[];
}

function attr(tag: string, name: string): string | null {
  const found = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return found ? decodeEntities(found[1]!) : null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Read the care form off the rendered page, in DOM order.
 *
 * The point is that nothing here decides what the body looks like: the fields
 * and their order come out of the HTML the server just sent, so a markup edit
 * moves this body with it.
 */
async function renderedForm(url: string, note: string): Promise<RenderedForm> {
  const page = await fetch(url);
  expect(page.status).toBe(200);
  const html = await page.text();
  const form = /<form class="care-form"([^>]*)>([\s\S]*?)<\/form>/.exec(html);
  if (!form) throw new Error(`no care form rendered at ${url}`);
  const action = attr(form[1]!, 'action');
  if (!action) throw new Error('the care form declares no action');

  const parts: Part[] = [];
  let pickedCategory = false;
  for (const field of form[2]!.matchAll(/<(input|textarea)\b([^>]*)>/g)) {
    const tag = field[2]!;
    const name = attr(tag, 'name');
    if (name === null) continue;
    const type = (attr(tag, 'type') ?? 'text').toLowerCase();
    if (type === 'file') {
      // Never stored, only counted (spec §12) — so any bytes will do, as long
      // as there are more of them than the head keeps.
      parts.push({ name, filename: 'tree.jpg', value: new Uint8Array(PHOTO_BYTES).fill(0x7f) });
      continue;
    }
    if (type === 'radio') {
      // A browser sends the one tile the visitor pressed; take the first.
      if (pickedCategory) continue;
      pickedCategory = true;
      parts.push({ name, value: attr(tag, 'value') ?? '' });
      continue;
    }
    if (field[1] === 'textarea') {
      parts.push({ name, value: note });
      continue;
    }
    parts.push({ name, value: attr(tag, 'value') ?? '' });
  }
  return { action, parts };
}

function multipart(parts: Part[]): Buffer {
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    const disposition =
      part.filename === undefined
        ? `Content-Disposition: form-data; name="${part.name}"\r\n\r\n`
        : `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
          'Content-Type: image/jpeg\r\n\r\n';
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n${disposition}`));
    chunks.push(typeof part.value === 'string' ? Buffer.from(part.value, 'utf8') : part.value);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

async function send(action: string, parts: Part[]): Promise<Response> {
  return fetch(`${origin}${action}`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, origin },
    body: new Uint8Array(multipart(parts)),
    redirect: 'manual',
  });
}

/** The photo moved to the front, and nothing else changed. */
function photoFirst(parts: Part[]): Part[] {
  const photo = parts.filter((part) => part.filename !== undefined);
  return [...photo, ...parts.filter((part) => part.filename === undefined)];
}

describe('the care form, posted exactly as it renders', () => {
  it('files the picker screen’s choice, with the photo recorded', async () => {
    const { action, parts } = await renderedForm(`${origin}/t/${TAG}/care`, '');
    // Read out of the HTML, not assumed — the file input comes last.
    expect(parts.map((part) => part.name)).toEqual(['category', 'photo']);

    const posted = await send(action, parts);
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe(`/t/${TAG}/thanks`);

    const chosen = parts.find((part) => part.name === 'category')!.value;
    const filed = await newestReport();
    expect(filed.category).toBe(chosen);
    expect(filed.photoAttached).toBe(true);
  });

  it('loses the category when the photo is sent first', async () => {
    await clearAsSteward();
    const before = (await storedReports()).length;
    const { action, parts } = await renderedForm(`${origin}/t/${TAG}/care`, '');

    const posted = await send(action, photoFirst(parts));
    // The category never reached the head, so the server sends the visitor
    // back to the picker and files nothing. This is the failure a markup
    // reorder would cause, which is what makes the case above a real test.
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe(`/t/${TAG}/care?pick=1`);
    expect((await storedReports()).length).toBe(before);
  });

  it('files the sentence screen’s note and hidden category', async () => {
    const sentence = 'The guard is bent where a car hit it.';
    const { action, parts } = await renderedForm(`${origin}/t/${TAG}/care?tell=1`, sentence);
    expect(parts.map((part) => part.name)).toEqual(['category', 'note', 'photo']);

    const posted = await send(action, parts);
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe(`/t/${TAG}/thanks`);

    const filed = await newestReport();
    expect(filed.category).toBe('other');
    expect(filed.note).toBe(sentence);
    expect(filed.photoAttached).toBe(true);
  });

  it('loses the sentence when the photo is sent first', async () => {
    await clearAsSteward();
    const before = (await storedReports()).length;
    const sentence = 'The soil has washed out on that side.';
    const { action, parts } = await renderedForm(`${origin}/t/${TAG}/care?tell=1`, sentence);

    const posted = await send(action, photoFirst(parts));
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe(`/t/${TAG}/care?pick=1`);
    expect((await storedReports()).length).toBe(before);
  });
});
