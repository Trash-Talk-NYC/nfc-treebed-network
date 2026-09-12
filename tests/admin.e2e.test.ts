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
import { ADMIN } from '../src/lib/copy';

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
    // The admin speaks both languages like every other screen. The bed label
    // prints the species standalone, so it is capitalized here — the stored
    // value is lowercase for the door sentence.
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
    // And the unsaved-changes guard starts armed: the flag rides the form,
    // which is what the script seeds from.
    expect(drawn).toMatch(/<form[^>]*data-dirty="true"/);

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

  it('marks a guard nobody has recorded as not set, until the admin picks one and saves', async () => {
    const cookie = await adminCookie();
    const headers = { 'content-type': 'application/x-www-form-urlencoded', origin, cookie };
    // Seeded beds start with the guard not yet recorded: the panel's own NOT
    // RECORDED radio is the one checked, it says so in both languages, and
    // the list line agrees.
    const before = await (
      await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1712`, { headers: { cookie } })
    ).text();
    expect(before).toContain('NOT SET');
    expect(before).toContain('SIN REGISTRAR');
    expect(before).toContain('guard not set');
    expect(before).toMatch(/name="guard" value="unset"[^>]*checked/);
    expect(before).not.toMatch(/name="guard" value="(none|wood|metal)"[^>]*checked/);

    // A save that carries no radio — the admin touched something else — keeps
    // the guard unrecorded rather than reading it as "none".
    const untouched = await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1712`, {
      method: 'POST',
      headers,
      body: new URLSearchParams({ plate: 'BED-WH-1712' }),
      redirect: 'manual',
    });
    expect(untouched.status).toBe(303);
    const still = await (
      await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1712`, { headers: { cookie } })
    ).text();
    expect(still).toContain('NOT SET');
    expect(still).toMatch(/name="guard" value="unset"[^>]*checked/);
    expect(still).not.toMatch(/name="guard" value="(none|wood|metal)"[^>]*checked/);

    const picked = await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1712`, {
      method: 'POST',
      headers,
      body: new URLSearchParams({ plate: 'BED-WH-1712', guard: 'wood' }),
      redirect: 'manual',
    });
    expect(picked.status).toBe(303);
    const after = await (
      await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1712`, { headers: { cookie } })
    ).text();
    // The guard's own not-recorded line is gone — the mark itself still
    // stands on the profile rows nobody has recorded yet.
    expect(after).not.toContain(ADMIN.guardUnsetSub.en);
    expect(after).toMatch(/name="guard" value="wood"[^>]*checked/);
    expect(after).toContain('wood guard');

    // And back: the captain records these one-handed on the street, so a
    // mis-tap has a way down rather than publishing a guard nobody verified.
    const unrecorded = await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1712`, {
      method: 'POST',
      headers,
      body: new URLSearchParams({ plate: 'BED-WH-1712', guard: 'unset' }),
      redirect: 'manual',
    });
    expect(unrecorded.status).toBe(303);
    const back = await (
      await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1712`, { headers: { cookie } })
    ).text();
    expect(back).toContain(ADMIN.guardUnsetSub.en);
    expect(back).toMatch(/name="guard" value="unset"[^>]*checked/);
    expect(back).toContain('guard not set');
  });

  it('reads the profile facts three ways, and says so until the admin picks', async () => {
    const cookie = await adminCookie();
    const headers = { 'content-type': 'application/x-www-form-urlencoded', origin, cookie };
    const panel = () =>
      fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1714`, { headers: { cookie } }).then((r) => r.text());

    // Seeded: nobody has recorded either fact, so the NOT RECORDED radio is
    // the one checked on each row and the panel says so in both languages.
    const before = await panel();
    expect(before).toContain(ADMIN.treePresentUnsetSub.en);
    expect(before).toContain(ADMIN.plantsPresentUnsetSub.en);
    expect(before).toContain(ADMIN.plantingRecommendedUnsetSub.es);
    expect(before).toMatch(/name="tree-present" value="unset"[^>]*checked/);
    expect(before).not.toMatch(/name="tree-present" value="(yes|no)"[^>]*checked/);
    expect(before).toMatch(/name="plants-present" value="unset"[^>]*checked/);
    expect(before).toMatch(/name="planting-recommended" value="unset"[^>]*checked/);
    expect(before).not.toMatch(/name="plants-present" value="(yes|no)"[^>]*checked/);
    expect(before).not.toMatch(/name="planting-recommended" value="(yes|no)"[^>]*checked/);

    // A save that carries neither radio keeps them unrecorded rather than
    // reading them as "no" — the guard's rule, applied here.
    const untouched = await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1714`, {
      method: 'POST',
      headers,
      body: new URLSearchParams({ plate: 'BED-WH-1714' }),
      redirect: 'manual',
    });
    expect(untouched.status).toBe(303);
    const kept = await panel();
    expect(kept).toContain(ADMIN.plantsPresentUnsetSub.en);
    // The tree is a radio for this reason: an unchecked checkbox and a field
    // that never arrived are the same bytes, and "no tree" is not what a
    // stale page or a hand-built POST gets to publish.
    expect(kept).toContain(ADMIN.treePresentUnsetSub.en);
    expect(kept).toMatch(/name="tree-present" value="unset"[^>]*checked/);

    const picked = await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1714`, {
      method: 'POST',
      headers,
      body: new URLSearchParams({
        plate: 'BED-WH-1714',
        'tree-present': 'no',
        'plants-present': 'yes',
        'planting-recommended': 'no',
        'care-note': 'Water twice a week.',
      }),
      redirect: 'manual',
    });
    expect(picked.status).toBe(303);
    const after = await panel();
    expect(after).not.toContain(ADMIN.treePresentUnsetSub.en);
    expect(after).toMatch(/name="tree-present" value="no"[^>]*checked/);
    expect(after).toContain('Water twice a week.');
    expect(after).not.toContain(ADMIN.plantsPresentUnsetSub.en);
    expect(after).not.toContain(ADMIN.plantingRecommendedUnsetSub.en);
    expect(after).toMatch(/name="plants-present" value="yes"[^>]*checked/);
    expect(after).toMatch(/name="planting-recommended" value="no"[^>]*checked/);

    // The NOT RECORDED choice takes both back, so an unverified fact that was
    // published by a mis-tap comes off the public page.
    const unrecorded = await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1714`, {
      method: 'POST',
      headers,
      body: new URLSearchParams({
        plate: 'BED-WH-1714',
        'tree-present': 'unset',
        'plants-present': 'unset',
        'planting-recommended': 'unset',
      }),
      redirect: 'manual',
    });
    expect(unrecorded.status).toBe(303);
    const back = await panel();
    // The note the last save typed survives a submit that carried no
    // textarea: keep-as-it-stands covers the whole profile, not just the
    // radios.
    expect(back).toContain('Water twice a week.');
    expect(back).toContain(ADMIN.treePresentUnsetSub.en);
    expect(back).toMatch(/name="tree-present" value="unset"[^>]*checked/);
    expect(back).toContain(ADMIN.plantsPresentUnsetSub.en);
    expect(back).toContain(ADMIN.plantingRecommendedUnsetSub.en);
    expect(back).toMatch(/name="plants-present" value="unset"[^>]*checked/);
    expect(back).not.toMatch(/name="plants-present" value="(yes|no)"[^>]*checked/);
  });

  it('shows the panel’s three-way rows as submitted when a save is refused', async () => {
    // A refused save re-renders rather than redirecting, and the badge, the
    // sub-line and the radios must read the same value: a panel that says NOT
    // SET beside a radio the captain has just checked is telling them their
    // pick was lost when it was not.
    const cookie = await adminCookie();
    const refused = await fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1715`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
      body: new URLSearchParams({
        plate: 'BED-WH-1715',
        guard: 'metal',
        'plants-present': 'yes',
        'slot-open': '9',
      }),
      redirect: 'manual',
    });
    expect(refused.status).toBe(422);
    const html = await refused.text();
    expect(html).toMatch(/name="guard" value="metal"[^>]*checked/);
    expect(html).toMatch(/name="plants-present" value="yes"[^>]*checked/);
    expect(html).not.toContain(ADMIN.guardUnsetSub.en);
    expect(html).not.toContain(ADMIN.plantsPresentUnsetSub.en);
    // The one row nobody picked still says so.
    expect(html).toContain(ADMIN.plantingRecommendedUnsetSub.en);
  });
});

describe('adding a bed through the real form', () => {
  it('says on the form that a known species needs no Spanish name', async () => {
    const cookie = await adminCookie();
    const html = await (
      await fetch(`${origin}${BLOCK_PATH}/add-bed`, { headers: { cookie } })
    ).text();
    expect(html).toContain('known species fill it in on their own');
    expect(html).toContain('las especies conocidas se completan solas');
  });

  it('fills the Spanish species from the table when the field is left blank', async () => {
    const cookie = await adminCookie();
    const saved = await fetch(`${origin}${BLOCK_PATH}/add-bed`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
      body: new URLSearchParams({ treeTypeEn: 'Pin oak', treeTypeEs: '' }),
      redirect: 'manual',
    });
    expect(saved.status).toBe(303);
    const location = saved.headers.get('location')!;
    expect(location).toMatch(/bed=BED-WH-\d+/);
    const html = await (await fetch(`${origin}${location}`, { headers: { cookie } })).text();
    // The bilingual label carries the table's Spanish; the English half is
    // exactly what the admin typed. The species is stored lowercase for the
    // door sentence and capitalized here, where the panel prints it standalone.
    expect(html).toContain('data-es="Roble palustre');
    expect(html).toContain('data-en="Pin oak');
  });

  it('degrades an unknown species to the generic wording, never a guess', async () => {
    const cookie = await adminCookie();
    const saved = await fetch(`${origin}${BLOCK_PATH}/add-bed`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
      body: new URLSearchParams({ treeTypeEn: 'Quixote tree', treeTypeEs: '' }),
      redirect: 'manual',
    });
    expect(saved.status).toBe(303);
    const location = saved.headers.get('location')!;
    const html = await (await fetch(`${origin}${location}`, { headers: { cookie } })).text();
    expect(html).toContain('data-en="Quixote tree');
    expect(html).toContain('data-es="Árbol');
  });
});

describe('the admin sees what a neighbour reported', () => {
  it('states the open report read-only in the bed panel, in both languages', async () => {
    const cookie = await adminCookie();
    const panel = () =>
      fetch(`${origin}${BLOCK_PATH}?bed=BED-WH-1713`, { headers: { cookie } }).then((r) => r.text());
    const send = (body: string) =>
      fetch(`${origin}/t/729v19w4/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
        body,
        redirect: 'manual',
      });

    const before = await panel();
    expect(before).toContain('No open report right now.');
    expect(before).toContain('No hay ningún reporte abierto ahora mismo.');

    // Two cookie-less presses are two identities (`/report` mints): the first
    // files, the second adds weight to the same report.
    expect((await send('category=litter&category=other&note=bolsas+en+la+esquina')).status).toBe(303);
    expect((await send('category=guard&note=the+guard+is+loose')).status).toBe(303);

    const after = await panel();
    expect(after).not.toContain('No open report right now.');
    expect(after).toContain('Litter');
    expect(after).toContain('Basura');
    expect(after).toContain('Something else');
    expect(after).toContain('bolsas en la esquina');
    expect(after).toMatch(/data-en="Opened [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M"/);
    expect(after).toContain('Abierto el ');
    expect(after).toContain('1 neighbour also reported it');
    expect(after).toContain('1 vecino más lo reportó');
    // And WHAT that neighbour said, not just that somebody did: the steward
    // reads it on their own view and the FAQ tells visitors we see the report.
    expect(after).toContain('Neighbours also said');
    expect(after).toContain('Los vecinos también dijeron');
    expect(after).toContain('Guard damage');
    expect(after).toContain('the guard is loose');
    // Read-only: the panel offers no way to close it.
    expect(after).not.toContain('/clear');
  });
});

describe('deleting a bed', () => {
  // BED-WH-1712 carries a real checked-in tag, which is the point: the
  // registry cannot be edited at runtime, so a deleted bed's tag has to
  // degrade to the calm "not assigned" screen on its own.
  const PLATE = 'BED-WH-1712';
  const TAG = '1hc0t9cj';

  it('reaches the delete only through its own confirmation page — the panel link writes nothing', async () => {
    const cookie = await adminCookie();
    const panel = await (
      await fetch(`${origin}${BLOCK_PATH}?bed=${PLATE}`, { headers: { cookie } })
    ).text();
    // A link to the confirmation, not a submit that deletes from the panel.
    expect(panel).toContain(`/delete-bed?bed=${PLATE}`);
    expect(panel).toContain('data-es="ELIMINAR ESTE CANTERO"');

    const confirm = await fetch(`${origin}${BLOCK_PATH}/delete-bed?bed=${PLATE}`, {
      headers: { cookie },
    });
    expect(confirm.status).toBe(200);
    const html = await confirm.text();
    // Says which bed, in both languages, and offers the way out beside the act.
    expect(html).toContain(PLATE);
    expect(html).toContain('Delete this bed');
    expect(html).toContain('data-es="Eliminar este cantero"');
    expect(html).toContain('data-es="CONSERVAR EL CANTERO"');
    // And the bed was NOT deleted by looking at the page.
    const list = await (await fetch(`${origin}${BLOCK_PATH}`, { headers: { cookie } })).text();
    expect(list).toContain(PLATE);
  });

  it('deletes on the confirmation POST: off the list, with the record-is-kept flash', async () => {
    const cookie = await adminCookie();
    const deleted = await fetch(`${origin}${BLOCK_PATH}/delete-bed?bed=${PLATE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
      body: new URLSearchParams({}),
      redirect: 'manual',
    });
    expect(deleted.status).toBe(303);
    const location = deleted.headers.get('location')!;
    expect(location).toContain('deleted=1');
    const after = await (await fetch(`${origin}${location}`, { headers: { cookie } })).text();
    // Off the street — no row that opens the panel — and held below it under
    // "Deleted beds", which is what a mis-tap is restored from.
    expect(after).not.toContain(`href="${BLOCK_PATH}?bed=${PLATE}"`);
    expect(after).toContain('Deleted beds');
    expect(after).toContain(PLATE);
    expect(after).toContain('Bed deleted');
    expect(after).toContain('data-es="Cantero eliminado. Su registro se conserva."');
  });

  it('degrades the still-bound tag to the calm not-assigned screen, never a 500', async () => {
    const tap = await fetch(`${origin}/t/${TAG}`);
    expect(tap.status).toBe(404);
    const html = await tap.text();
    expect(html).toContain('assigned to a bed yet');
    expect(html).toContain(TAG);
    // And a POST at its report route answers plain text, before any rule runs.
    const report = await fetch(`${origin}/t/${TAG}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: new URLSearchParams({ category: 'litter' }),
      redirect: 'manual',
    });
    expect(report.status).toBe(404);
    expect((report.headers.get('content-type') ?? '').startsWith('text/plain')).toBe(true);
  });

  it('sends a steward’s own sub-page to that same calm screen, in either language', async () => {
    // A bookmarked /mine — or one in history — must not answer a bare line of
    // English. The door screen is where the calm screen lives, so every
    // sub-page hands the visitor to it and the language rides along.
    for (const [query, expected] of [
      ['', 'assigned to a bed yet'],
      ['?lang=es', 'todavía no está asignada'],
    ] as const) {
      const hop = await fetch(`${origin}/t/${TAG}/mine${query}`, { redirect: 'manual' });
      expect(hop.status).toBe(302);
      expect(hop.headers.get('location')).toBe(`/t/${TAG}${query}`);
      const screen = await fetch(`${origin}${hop.headers.get('location')!}`);
      expect(screen.status).toBe(404);
      expect(await screen.text()).toContain(expected);
    }
  });

  it('leaves the live tap flow untouched: the neighbouring bed and the demo bed still answer', async () => {
    const neighbour = await fetch(`${origin}/t/jjhq9gfj`);
    expect(neighbour.status).toBe(200);
    expect(await neighbour.text()).not.toContain('assigned to a bed yet');
    const demo = await fetch(`${origin}/t/2mq2amhv`);
    expect(demo.status).toBe(200);
    expect(await demo.text()).toContain('@marisol_r');
  });

  it('answers a resubmitted confirmation with the block page, not an error', async () => {
    const cookie = await adminCookie();
    const again = await fetch(`${origin}${BLOCK_PATH}/delete-bed?bed=${PLATE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
      body: new URLSearchParams({}),
      redirect: 'manual',
    });
    expect(again.status).toBe(303);
    expect(again.headers.get('location')).toContain('deleted=1');
  });

  it('answers SAVE CHANGES on a bed deleted from another tab with the block page, keeping the typed address', async () => {
    // The stale tab: the panel was open when the bed went, and the press has
    // to land somewhere with a way back — mid-walk, one-handed. Nothing was
    // written, so the address the captain retyped comes back in the field
    // rather than being dropped by a redirect, and the page says so.
    const cookie = await adminCookie();
    const typed = '712 W 171st St';
    const saved = await fetch(`${origin}${BLOCK_PATH}?bed=${PLATE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
      body: new URLSearchParams({ plate: PLATE, referenceAddress: typed, guard: 'on' }),
      redirect: 'manual',
    });
    expect(saved.status).toBe(409);
    const after = await saved.text();
    expect(after).toContain('was deleted somewhere else');
    expect(after).toContain('Nothing was saved');
    expect(after).toContain('press SAVE ADDRESS to keep it');
    expect(after).toContain('data-es="Este cantero se eliminó en otro lugar');
    expect(after).toContain('presione GUARDAR DIRECCIÓN para conservarla');
    // The typed address is in the field, one SAVE ADDRESS away from landing.
    expect(after).toContain(`value="${typed}"`);
    expect(after).toContain('SAVE ADDRESS');
    // This lands in list mode, where the save-state line does not render —
    // so the unsaved-changes guard must find its flag on the form itself, or
    // the address the page just said it kept is dropped by the next tap.
    expect(after).not.toMatch(/<div[^>]*data-save-state/);
    expect(after).toMatch(/<form[^>]*data-dirty="true"/);
    // And it really was not written: a fresh load still shows the old address,
    // and carries no dirty flag.
    const fresh = await (await fetch(`${origin}${BLOCK_PATH}`, { headers: { cookie } })).text();
    expect(fresh).not.toContain(`value="${typed}"`);
    expect(fresh).not.toMatch(/<form[^>]*data-dirty/);
  });

  it('reports only the deletion when the stale save carried the address as stored', async () => {
    // The captain flipped the guard and nothing else: the field holds the
    // stored address, a SAVE ADDRESS would write nothing, and a page that
    // asked to keep it — or prompted on leaving — would be guarding nothing.
    const cookie = await adminCookie();
    const stored = '708 W 171st St';
    const saved = await fetch(`${origin}${BLOCK_PATH}?bed=${PLATE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
      body: new URLSearchParams({ plate: PLATE, referenceAddress: ` ${stored} `, guard: 'on' }),
      redirect: 'manual',
    });
    expect(saved.status).toBe(409);
    const after = await saved.text();
    expect(after).toContain('was deleted somewhere else');
    expect(after).toContain('Nothing was saved.');
    expect(after).not.toContain('press SAVE ADDRESS to keep it');
    expect(after).toContain('data-es="Este cantero se eliminó en otro lugar');
    expect(after).not.toContain('GUARDAR DIRECCIÓN para conservarla');
    expect(after).not.toMatch(/<form[^>]*data-dirty/);
  });

  it('keeps the plain 404 for a block that does not exist — only the bed gets the screen', async () => {
    const cookie = await adminCookie();
    const missing = await fetch(`${origin}/admin/blocks/no-such-block`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
      body: new URLSearchParams({ referenceAddress: '710 W 171st St' }),
      redirect: 'manual',
    });
    expect(missing.status).toBe(404);
  });
});

describe('restoring a deleted bed', () => {
  // The same bed the delete tests retired, and the same tag: the registry is
  // checked in and cannot be rewritten at runtime, so the way back from a
  // mis-tap has to be a store write the admin itself can make. Retired here
  // too, so this suite proves restore on its own rather than on whatever the
  // suite above happened to leave behind.
  const PLATE = 'BED-WH-1712';
  const TAG = '1hc0t9cj';

  beforeAll(async () => {
    const cookie = await adminCookie();
    await fetch(`${origin}${BLOCK_PATH}/delete-bed?bed=${PLATE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
      body: new URLSearchParams({}),
      redirect: 'manual',
    });
  });

  it('lists the deleted bed apart from the street, with RESTORE as its only affordance', async () => {
    const cookie = await adminCookie();
    const list = await (await fetch(`${origin}${BLOCK_PATH}`, { headers: { cookie } })).text();
    expect(list).toContain('Deleted beds');
    expect(list).toContain('data-es="Canteros eliminados"');
    expect(list).toContain('data-es="RESTAURAR"');
    // RESTORE is a LINK out of the page, not a submit inside the block form:
    // a submit fires the form's own submit handler, which disarms the
    // unsaved-changes guard and would drop whatever the panel still held.
    // The structure is what makes the browser prompt fire, so it is what is
    // pinned here — a fetch-based suite has no browser to observe it in.
    expect(list).toContain(`href="${BLOCK_PATH}/restore-bed?bed=${PLATE}"`);
    expect(list).not.toContain(`name="restore"`);
    // A deleted row is not a way into the panel either.
    expect(list).not.toContain(`href="${BLOCK_PATH}?bed=${PLATE}"`);
  });

  it('puts the bed and its tag back on the confirmation’s own POST, with nothing else changed', async () => {
    const cookie = await adminCookie();
    const confirm = await fetch(`${origin}${BLOCK_PATH}/restore-bed?bed=${PLATE}`, {
      headers: { cookie },
    });
    expect(confirm.status).toBe(200);
    const confirmHtml = await confirm.text();
    expect(confirmHtml).toContain('Restore this bed');
    expect(confirmHtml).toContain('data-es="RESTAURAR ESTE CANTERO"');

    const restored = await fetch(`${origin}${BLOCK_PATH}/restore-bed?bed=${PLATE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
      body: new URLSearchParams({}),
      redirect: 'manual',
    });
    expect(restored.status).toBe(303);
    const location = restored.headers.get('location')!;
    expect(location).toContain('restored=1');
    // The LIST, not the bed's panel: `?bed=` puts the page in panel mode, and
    // the phone breakpoint hides the column the flash renders in (admin.css),
    // so a restore on the surface the captain actually uses would confirm
    // nothing. `mode-list` is what proves the flash is on screen there.
    expect(location).not.toContain('bed=');
    const landing = await (await fetch(`${origin}${location}`, { headers: { cookie } })).text();
    expect(landing).toContain('mode-list');
    const after = await (await fetch(`${origin}${location}`, { headers: { cookie } })).text();
    expect(after).toContain(PLATE);
    expect(after).toContain('Bed restored');
    expect(after).not.toContain('Deleted beds');

    // And the tap the delete had taken away answers again, with no deploy.
    const tap = await fetch(`${origin}/t/${TAG}`);
    expect(tap.status).toBe(200);
    expect(await tap.text()).not.toContain('assigned to a bed yet');
  });

  it('answers a resubmitted confirmation with the block page, not an error', async () => {
    const cookie = await adminCookie();
    const again = await fetch(`${origin}${BLOCK_PATH}/restore-bed?bed=${PLATE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
      body: new URLSearchParams({}),
      redirect: 'manual',
    });
    expect(again.status).toBe(303);
    expect(again.headers.get('location')).toContain('restored=1');
  });

  it('opens a restore link on a live bed onto the plain block page, with no "restored" flash', async () => {
    // A bookmarked or history-navigated link is not a press: the bed was not
    // restored by it, so the page must not say it was. Restored here first,
    // so the case stands on its own rather than on the one above.
    const cookie = await adminCookie();
    await fetch(`${origin}${BLOCK_PATH}/restore-bed?bed=${PLATE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
      body: new URLSearchParams({}),
      redirect: 'manual',
    });
    const opened = await fetch(`${origin}${BLOCK_PATH}/restore-bed?bed=${PLATE}`, {
      headers: { cookie },
      redirect: 'manual',
    });
    expect(opened.status).toBe(302);
    const location = opened.headers.get('location')!;
    expect(location).toBe(BLOCK_PATH);
    const landing = await (await fetch(`${origin}${location}`, { headers: { cookie } })).text();
    expect(landing).not.toContain('Bed restored');
  });

  it('takes no restore from a caller with no session', async () => {
    const refused = await fetch(`${origin}${BLOCK_PATH}/restore-bed?bed=BED-WH-1713`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: new URLSearchParams({}),
      redirect: 'manual',
    });
    expect(refused.status).toBe(303);
    expect(refused.headers.get('location')).toBe('/admin');
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
