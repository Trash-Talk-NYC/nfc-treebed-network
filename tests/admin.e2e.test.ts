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

  it('refuses a gapped slot selection and comes back with the switches as they were left', async () => {
    const cookie = await adminCookie();
    // Two slots, then slot 2 alone: `offeredSlots` is a count covering 1..n,
    // so this selection has no representation and must not be re-mapped.
    await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1714`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
      body: new URLSearchParams({ plate: 'BED-WH-1714', 'add-slot': '1' }),
      redirect: 'manual',
    });
    const refused = await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1714`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
      body: new URLSearchParams({ plate: 'BED-WH-1714', 'slot-open': '2' }),
      redirect: 'manual',
    });
    expect(refused.status).toBe(422);
    const html = await refused.text();
    // Said in both languages, and the switch the captain flipped is the one
    // that comes back on.
    expect(html).toContain('Open slots run in order');
    expect(html).toContain('Los lugares se abren en orden');
    expect(html).toMatch(/name="slot-open" value="2"[^>]*checked/);
    expect(html).not.toMatch(/name="slot-open" value="1"[^>]*checked/);
    // Nothing was written.
    const bed = await (
      await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1714`, { headers: { cookie } })
    ).text();
    expect(bed).not.toMatch(/name="slot-open"[^>]*checked/);
  });

  it('draws the slot "+ ADD SLOT" adds without writing one, and saves it only on SAVE CHANGES', async () => {
    const cookie = await adminCookie();
    const headers = { 'content-type': 'application/x-www-form-urlencoded', origin, cookie };
    // The press is page-local: a bed cannot give a slot back, so a mis-tap
    // must cost a re-render rather than growing the record for good.
    const pressed = await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1715`, {
      method: 'POST',
      headers,
      body: new URLSearchParams({ plate: 'BED-WH-1715', intent: 'add-slot' }),
      redirect: 'manual',
    });
    expect(pressed.status).toBe(200);
    const drawn = await pressed.text();
    expect(drawn).toMatch(/name="slot-open" value="2"/);
    // And the page says so, in both languages.
    expect(drawn).toContain('Unsaved changes');
    expect(drawn).toContain('Hay cambios sin guardar');

    const reloaded = await (
      await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1715`, { headers: { cookie } })
    ).text();
    expect(reloaded).not.toMatch(/name="slot-open" value="2"/);

    // The hidden carrier the press leaves behind is what a real SAVE CHANGES
    // submits, and that is the one thing that grows the bed.
    const saved = await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1715`, {
      method: 'POST',
      headers,
      body: new URLSearchParams({ plate: 'BED-WH-1715', 'add-slot': '1' }),
      redirect: 'manual',
    });
    expect(saved.status).toBe(303);
    const after = await (
      await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1715`, { headers: { cookie } })
    ).text();
    expect(after).toMatch(/name="slot-open" value="2"/);
  });

  it('tells a stale tab its slot is gone rather than telling it to reorder switches', async () => {
    const cookie = await adminCookie();
    const refused = await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1716`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
      body: new URLSearchParams({ plate: 'BED-WH-1716', 'slot-open': '9' }),
      redirect: 'manual',
    });
    expect(refused.status).toBe(422);
    const html = await refused.text();
    expect(html).toContain('That slot isn');
    expect(html).toContain('Ese lugar ya no existe');
    expect(html).not.toContain('Open slots run in order');
  });
});

describe('the way out of the admin', () => {
  it('offers sign-out on the admin page and clears the session cookie', async () => {
    const cookie = await adminCookie();
    const page = await (await fetch(`${origin}${BLOCK_PATH}`, { headers: { cookie } })).text();
    expect(page).toContain('/admin/sign-out');
    expect(page).toContain('data-es="CERRAR SESIÓN"');

    const out = await fetch(`${origin}/admin/sign-out`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
      redirect: 'manual',
    });
    expect(out.status).toBe(303);
    expect(out.headers.get('location')).toBe('/admin');
    const cleared = out.headers.getSetCookie().find((line) => line.startsWith('tg_admin='));
    expect(cleared).toBeTruthy();
    expect(cleared).toMatch(/tg_admin=;|Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });

  it('has nothing to sign out of without a session, and no key screen control', async () => {
    const refused = await fetch(`${origin}/admin/sign-out`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      redirect: 'manual',
    });
    expect(refused.status).toBe(303);
    expect(refused.headers.get('location')).toBe('/admin');
    expect(await (await fetch(`${origin}/admin`)).text()).not.toContain('/admin/sign-out');
  });

  it('answers a GET at the sign-out route 405 rather than a logged 404', async () => {
    const cookie = await adminCookie();
    const response = await fetch(`${origin}/admin/sign-out`, { headers: { cookie } });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('will not take an actor cookie as an admin one', async () => {
    // A signed `tg_visitor`, minted by the door screen, replayed as tg_admin:
    // the MACs are made for different purposes, so it cannot verify.
    const door = await fetch(`${origin}/t/2mq2amhv`);
    const visitor = door.headers
      .getSetCookie()
      .map((line) => line.split(';')[0]!)
      .find((pair) => pair.startsWith('tg_visitor='));
    expect(visitor).toBeTruthy();
    const value = visitor!.slice('tg_visitor='.length);
    const replayed = await fetch(`${origin}${BLOCK_PATH}`, {
      headers: { cookie: `tg_admin=${value}` },
      redirect: 'manual',
    });
    expect(replayed.status).toBe(302);
    expect(replayed.headers.get('location')).toBe('/admin');
  });
});
