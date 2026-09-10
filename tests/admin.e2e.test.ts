// The admin surface, against the real rendered HTML: the door is closed
// until the key opens it, and the contact details live only behind it.
//
// "Contact details are admin-only" (design-record.md, constraint 5) is a
// property of RESPONSES, not of helpers, so the proof is a real server: what
// a session-less caller receives, what the key screen leaks (nothing), and
// what the opened admin then shows. The public-screen half of the same
// constraint — no PII on any visitor response — is steward-privacy.e2e.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ADMIN_KEY = 'e2e-admin-key-with-plenty-of-entropy';
const BLOCK_PATH = '/admin/blocks/w-171-fort-washington-haven';

let server: ChildProcessWithoutNullStreams;
let origin = '';
let dataDir = '';

beforeAll(async () => {
  const built = spawnSync('npm', ['run', 'build'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (built.status !== 0) throw new Error(`build failed:\n${built.stdout}\n${built.stderr}`);

  dataDir = await mkdtemp(path.join(tmpdir(), 'treebed-admin-'));
  const child = spawn(process.execPath, ['dist/server/entry.mjs'], {
    env: {
      ...process.env,
      TREEBED_SESSION_SECRET: 'e2e-secret-not-a-real-one',
      TREEBED_ADMIN_KEY: ADMIN_KEY,
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

/** Sign in through the real key form and hand back the session cookie. */
async function adminCookie(): Promise<string> {
  const response = await fetch(`${origin}/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: new URLSearchParams({ key: ADMIN_KEY }),
    redirect: 'manual',
  });
  expect(response.status).toBe(303);
  const cookie = response.headers
    .getSetCookie()
    .map((line) => line.split(';')[0]!)
    .find((pair) => pair.startsWith('tg_admin='));
  expect(cookie).toBeTruthy();
  return cookie!;
}

describe('the admin door', () => {
  it('sends a session-less caller to the key screen, which holds no data', async () => {
    const refused = await fetch(`${origin}${BLOCK_PATH}`, { redirect: 'manual' });
    expect(refused.status).toBe(302);
    expect(refused.headers.get('location')).toBe('/admin');

    const keyScreen = await fetch(`${origin}/admin`);
    const html = await keyScreen.text();
    expect(html).not.toContain('marisol');
    expect(html).not.toContain('@example');
    expect(html).not.toContain('BED-');
  });

  it('refuses a wrong key with one flat answer', async () => {
    const response = await fetch(`${origin}/admin`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: new URLSearchParams({ key: 'not-the-key' }),
      redirect: 'manual',
    });
    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie().join('')).not.toContain('tg_admin');
    // The wrong key is never echoed back.
    expect(await response.text()).not.toContain('not-the-key');
  });

  it('opens the block page behind the key: six beds, bilingual, plate shown to the admin only', async () => {
    const cookie = await adminCookie();
    const page = await fetch(`${origin}${BLOCK_PATH}`, { headers: { cookie } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('708 W 171st St');
    for (let n = 1; n <= 6; n++) expect(html).toContain(`BED-WH-171${n}`);
    // The admin speaks both languages like every other screen.
    expect(html).toContain('data-es="Roble blanco');

    // The opened white oak carries its resolved NYC planting space — the
    // real record, not the mockup's placeholder number.
    const panel = await (
      await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1715`, { headers: { cookie } })
    ).text();
    expect(panel).toContain('#1188102');
    expect(panel).not.toContain('15850293');
  });

  it('shows contact details on the steward click-through — and only there', async () => {
    const cookie = await adminCookie();
    const demoBlock = await (
      await fetch(`${origin}/admin/blocks/w-138-acp-demo?bed=BED-HRL-0847`, { headers: { cookie } })
    ).text();
    // The list view names the steward, never the contact details.
    expect(demoBlock).toContain('@marisol_r');
    expect(demoBlock).not.toContain('seed-marisol@example.invalid');

    const userId = /steward=([a-z0-9-]+)/.exec(demoBlock)?.[1];
    expect(userId).toBeTruthy();
    const detail = await (
      await fetch(`${origin}/admin/blocks/w-138-acp-demo?bed=BED-HRL-0847&steward=${userId}`, {
        headers: { cookie },
      })
    ).text();
    expect(detail).toContain('Marisol');
    expect(detail).toContain('Rivera');
    expect(detail).toContain('seed-marisol@example.invalid');
    expect(detail).toContain('+1 555 010 0847');
  });

  it('saves the opened bed: a switched-on slot comes back switched on', async () => {
    const cookie = await adminCookie();
    const saved = await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1713`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
      body: new URLSearchParams({
        referenceAddress: '708 W 171st St',
        plate: 'BED-WH-1713',
        'slot-open': '1',
      }),
      redirect: 'manual',
    });
    expect(saved.status).toBe(303);
    const location = saved.headers.get('location')!;
    expect(location).toContain('saved=1');
    const after = await (await fetch(`${origin}${location}`, { headers: { cookie } })).text();
    expect(after).toMatch(/name="slot-open"[^>]*checked/);
  });
});
