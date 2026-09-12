// The steward's screens, against the real rendered HTML: a steward who asked
// not to be named, and what a second neighbour's press reaches them as.
//
// `Adoption.displayNameHidden` is a person asking not to have their name on a
// screen bolted to a sidewalk, so the proof has to be the HTML a passer-by
// receives — not a helper returning the right list. It also has to prove the
// other half: the bed still reads as ADOPTED. Falling through to door 1 would
// invite a stranger to adopt a bed that is taken, which is the worse mistake
// of the two.
//
// Slow by nature (a build plus a server), so it lives in the e2e suite.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seedData } from '../src/lib/store-dataset';
import { signInByLink } from './helpers/steward-session';
import { defaultPresentation } from '../src/lib/presentation';
import { DOOR_NOT_OFFERED, DOOR_STEWARDED, DOOR_UNSTEWARDED, COMMON } from '../src/lib/copy';
import { problemFor } from '../src/lib/problem';

/** The seeded demo tag (tag-bindings.ts), bound to the seeded bed BED-HRL-0847. */
const TAG = '2mq2amhv';

/** The page ground, read from the presentation rather than typed as a hex. */
const DEFAULT_GROUND = defaultPresentation().colors.ground;

let server: ChildProcessWithoutNullStreams;
let origin = '';
let dataDir = '';

/** The steward's session cookie, fetched once through the emailed link. */
let cachedSession: string | null = null;
async function stewardSession(): Promise<string> {
  cachedSession ??= await signInByLink(origin, dataDir, TAG);
  return cachedSession;
}

beforeAll(async () => {
  const built = spawnSync('npm', ['run', 'build'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (built.status !== 0) throw new Error(`build failed:\n${built.stdout}\n${built.stderr}`);

  dataDir = await mkdtemp(path.join(tmpdir(), 'treebed-privacy-'));
  // The store the server will find already there: the seeded adoption, with
  // its steward hidden. Nothing in the visitor flow can set the flag — the
  // admin page that will is a later task — so the state is written directly,
  // which is also the state that page will produce.
  const data = seedData();
  data.adoptions[0]!.displayNameHidden = true;
  await writeFile(path.join(dataDir, 'store.json'), JSON.stringify(data, null, 2), 'utf8');

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

/** A second server over a bed nobody has adopted, so door 1 can be measured. */
let openServer: ChildProcessWithoutNullStreams;
let openOrigin = '';
let openDataDir = '';

async function startOn(data: Awaited<ReturnType<typeof seedData>>): Promise<[ChildProcessWithoutNullStreams, string, string]> {
  const dir = await mkdtemp(path.join(tmpdir(), 'treebed-door1-'));
  await writeFile(path.join(dir, 'store.json'), JSON.stringify(data, null, 2), 'utf8');
  const child = spawn(process.execPath, ['dist/server/entry.mjs'], {
    env: {
      ...process.env,
      TREEBED_SESSION_SECRET: 'e2e-secret-not-a-real-one',
      TREEBED_DATA_DIR: dir,
      HOST: '127.0.0.1',
      PORT: '0',
    },
  }) as ChildProcessWithoutNullStreams;
  let log = '';
  child.stderr.on('data', (buf: Buffer) => {
    log += String(buf);
  });
  const url = await new Promise<string>((resolve, reject) => {
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
  return [child, url, dir];
}

describe('the door a bed with no steward opens', () => {
  // The captain moved this screen onto Poster Beige and dropped the highlight
  // after the review. Both are visible facts about the rendered HTML, and both
  // are the kind of thing a later "tidy-up" would undo by making the two doors
  // match — so they are asserted rather than left to a comment.
  beforeAll(async () => {
    const data = seedData();
    data.adoptions = [];
    [openServer, openOrigin, openDataDir] = await startOn(data);
  }, 60_000);

  afterAll(async () => {
    openServer?.kill();
    if (openDataDir) await rm(openDataDir, { recursive: true, force: true });
  });

  it('stands on the page ground, not the green, and carries no highlight', async () => {
    const response = await fetch(`${openOrigin}/t/${TAG}`);
    expect(response.status).toBe(200);
    const html = await response.text();

    // It is door 1.
    expect(html).toContain(DOOR_UNSTEWARDED.adopt.en);
    expect(html).toContain(DOOR_UNSTEWARDED.headAfter.en);

    // On the page ground: no green screen class, and the browser chrome behind
    // the notch matches the beige rather than staying on the old green.
    // Anchored to the class ATTRIBUTE — `ground-clear` also appears in the
    // inlined stylesheet, which a bare substring match would find on every
    // screen and pass on none.
    expect(html).toContain('class="frame ground-page"');
    expect(html).not.toContain('class="frame ground-clear"');
    expect(html).not.toContain('class="screen screen-clear"');
    expect(html).toContain(`content="${DEFAULT_GROUND}"`);

    // One plain sentence: the tree type is still its own bilingual leaf, but
    // nothing picks it out.
    expect(html).not.toContain('class="hl"');
    expect(html).toContain('data-es="roble sauce"');

    // Same two buttons, same order, in the page ground's own pair.
    const adoptAt = html.indexOf(DOOR_UNSTEWARDED.adopt.en);
    const careAt = html.indexOf(COMMON.needsCare.en);
    expect(adoptAt).toBeGreaterThan(-1);
    expect(careAt).toBeGreaterThan(adoptAt);
    expect(html).toContain('class="btn btn-tall btn-action"');
    expect(html).toContain('class="btn btn-outline"');
    // Anchored to the attribute for the same reason as the ground above: the
    // green-ground button classes are defined in the inlined stylesheet on
    // every screen, so a bare substring would never fail.
    expect(html).not.toContain('class="btn btn-tall btn-on-clear"');
  });

  it('says all of it in Spanish too', async () => {
    const html = await (await fetch(`${openOrigin}/t/${TAG}?lang=es`)).text();
    expect(html).toContain(DOOR_UNSTEWARDED.adopt.es);
    expect(html).toContain(DOOR_UNSTEWARDED.sub.es);
    expect(html).toContain(COMMON.needsCare.es);
    // Still the beige ground, whichever language it is read in.
    expect(html).toContain('class="frame ground-page"');
    expect(html).not.toContain('class="screen screen-clear"');
    expect(html).not.toContain('class="hl"');
  });
});

describe('the door a bed nobody has offered a slot on opens', () => {
  // Every W 171st bed ships in this state: built, tagged, and waiting for the
  // captain to open a slot on the admin page. The screen must not invite
  // somebody to put their name on a bed it has no way to accept — the
  // invitation is withheld, and the words say why.
  let quietServer: ChildProcessWithoutNullStreams;
  let quietOrigin = '';
  let quietDataDir = '';

  beforeAll(async () => {
    const data = seedData();
    data.adoptions = [];
    data.beds['BED-HRL-0847']!.offeredSlots = 0;
    [quietServer, quietOrigin, quietDataDir] = await startOn(data);
  }, 60_000);

  afterAll(async () => {
    quietServer?.kill();
    if (quietDataDir) await rm(quietDataDir, { recursive: true, force: true });
  });

  it('says the bed is not open yet, and offers only the care door', async () => {
    const response = await fetch(`${quietOrigin}/t/${TAG}`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain(DOOR_NOT_OFFERED.headAfter.en);
    expect(html).toContain(DOOR_NOT_OFFERED.sub.en);
    // No invitation of any kind: not the headline, not the sub, not the button.
    expect(html).not.toContain(DOOR_UNSTEWARDED.adopt.en);
    expect(html).not.toContain(DOOR_UNSTEWARDED.headAfter.en);
    expect(html).not.toContain(DOOR_UNSTEWARDED.sub.en);
    expect(html).toContain(COMMON.needsCare.en);

    // Still door 1's own ground and pair: beige, no highlight, no yellow.
    expect(html).toContain('class="frame ground-page"');
    expect(html).not.toContain('class="screen screen-clear"');
    expect(html).not.toContain('class="hl"');
    expect(html).toContain('class="btn btn-outline"');
    expect(html).not.toContain('class="btn btn-tall btn-action"');
  });

  it('says it in Spanish too', async () => {
    const html = await (await fetch(`${quietOrigin}/t/${TAG}?lang=es`)).text();
    expect(html).toContain(DOOR_NOT_OFFERED.headAfter.es);
    expect(html).toContain(DOOR_NOT_OFFERED.sub.es);
    expect(html).not.toContain(DOOR_UNSTEWARDED.adopt.es);
    expect(html).not.toContain(DOOR_UNSTEWARDED.sub.es);
    expect(html).toContain(COMMON.needsCare.es);
    expect(html).toContain('class="frame ground-page"');
    expect(html).not.toContain('class="hl"');
  });
});

describe('the shipped W 171st tags', () => {
  // The four Haven-end willow oaks (tag-bindings.ts) against the SHIPPED seed
  // — no data surgery, unlike the doors measured above — because these tags
  // are handed to the captain as links, and what each must open is decided by
  // the registry row plus the seeded bed together. All four beds seed
  // unoffered (`offeredSlots: 0`, store-dataset.ts), so every one renders the
  // not-yet-open door until the captain opens a slot; flipping one open is a
  // data change, and this test then follows the data, not the code.
  // The server behind `origin` mutates only the demo bed's adoption, so for
  // these beds it IS the shipped seed.
  const shipped: Record<string, string> = {
    jjhq9gfj: '2332471',
    '1hc0t9cj': '2332470',
    '729v19w4': '2332469',
    jpv8bksx: '2332468',
  };

  it('each opens the not-yet-open door for its own bed', async () => {
    for (const [tagId, plantingSpaceId] of Object.entries(shipped)) {
      const response = await fetch(`${origin}/t/${tagId}`);
      expect(response.status, tagId).toBe(200);
      const html = await response.text();

      // The right bed: the NYC planting space ID is the one public identity.
      expect(html, tagId).toContain(`#${plantingSpaceId}`);
      expect(html, tagId).toContain('data-es="roble sauce"');

      // The not-yet-open door, with no invitation anywhere on it.
      expect(html, tagId).toContain(DOOR_NOT_OFFERED.headAfter.en);
      expect(html, tagId).toContain(DOOR_NOT_OFFERED.sub.en);
      expect(html, tagId).not.toContain(DOOR_UNSTEWARDED.adopt.en);
      expect(html, tagId).not.toContain(DOOR_UNSTEWARDED.headAfter.en);
      expect(html, tagId).toContain(COMMON.needsCare.en);
      expect(html, tagId).not.toContain(DOOR_STEWARDED.applaud.en);

      // Door 1's ground, not the adopted green.
      expect(html, tagId).toContain('class="frame ground-page"');
      expect(html, tagId).not.toContain('class="screen screen-clear"');
    }
  });

  it('says it in Spanish too', async () => {
    const html = await (await fetch(`${origin}/t/jjhq9gfj?lang=es`)).text();
    expect(html).toContain(DOOR_NOT_OFFERED.headAfter.es);
    expect(html).toContain(DOOR_NOT_OFFERED.sub.es);
    expect(html).toContain('roble sauce');
    // The headline is split into leaves either side of the species, so the
    // sentence only reads right once the tags are gone: the species sits
    // lowercase inside the fixed frame.
    const text = html.replace(/<[^>]+>/g, '');
    expect(text).toContain('El cantero de este roble sauce');
    expect(html).not.toContain(DOOR_UNSTEWARDED.adopt.es);
  });
});

describe('a steward who asked not to be named', () => {
  it('is nowhere on the public screen, which still reads as adopted', async () => {
    const response = await fetch(`${origin}/t/${TAG}`);
    expect(response.status).toBe(200);
    const html = await response.text();

    // Neither the handle nor the initials, in either language's attribute.
    expect(html).not.toContain('marisol_r');
    expect(html).not.toContain('M. R.');
    // Anchored to the element that carries the initials: a bare `MR` would be
    // matched against the whole document, script and stylesheet included.
    expect(html).not.toContain('class="av">MR<');
    // And no empty stewards panel left standing over nobody.
    expect(html).not.toContain(COMMON.stewards.en);

    // Door 2 all the same: adopted, applause, and the way to report a problem.
    expect(html).toContain(DOOR_STEWARDED.headAfter.en);
    expect(html).toContain(DOOR_STEWARDED.applaud.en);
    expect(html).toContain(COMMON.needsCare.en);
    // Never door 1 — the bed is taken, and inviting a stranger to adopt it
    // would be the worse mistake.
    expect(html).not.toContain(DOOR_UNSTEWARDED.adopt.en);
    expect(html).not.toContain(DOOR_UNSTEWARDED.headAfter.en);
  });

  it('still sees their own bed, and themselves on it', async () => {
    // Hiding is about the public screen. A steward who is invisible on the
    // sidewalk must not be invisible to themselves on the view that carries
    // the clear button. Signed in the shipped way: the emailed link, read
    // out of the dev outbox.
    const cookie = await stewardSession();

    const mine = await fetch(`${origin}/t/${TAG}/mine`, { headers: { cookie } });
    expect(mine.status).toBe(200);
    const html = await mine.text();
    expect(html).toContain('marisol_r');
    expect(html).toContain('M. R.');

    // The weekly-photo ask is gone from the steward's own screen (captain,
    // 2026-09-11): no photo button, no photo-streak stat, in either language.
    // Club points stay. The strings are literal because their copy keys went
    // with the feature.
    expect(html).not.toContain("GIVE THIS WEEK'S PHOTO");
    expect(html).not.toContain('week photo streak');
    expect(html).toContain('club points');
    // And the route the button posted to is gone with it, not just unlinked.
    const photoPost = await fetch(`${origin}/t/${TAG}/photo`, {
      method: 'POST',
      headers: { origin, cookie: cookie! },
      redirect: 'manual',
    });
    expect(photoPost.status).toBe(404);

    // The species is stored in the casing the door sentence needs, and this
    // screen prints it standalone as its heading: capitalized here, lowercase
    // inside "El cantero de este roble sauce…" on the same bed's door.
    expect(html).toContain('data-es="Roble sauce"');
    expect(html).toContain('data-en="Willow oak"');
    const door = await (await fetch(`${origin}/t/${TAG}?lang=es`)).text();
    expect(door.replace(/<[^>]+>/g, '')).toContain('este roble sauce');

    // A document title is a standalone label wherever the species sits in it,
    // so every screen's Spanish title capitalizes what the sentence does not.
    const titleOf = (page: string) => /<title>([^<]*)<\/title>/.exec(page)?.[1];
    expect(titleOf(html)).toBe('YOUR BED · Willow oak');
    expect(titleOf(door)).toBe('Roble sauce · TRASH TALK NYC');
    const mineEs = await fetch(`${origin}/t/${TAG}/mine?lang=es`, { headers: { cookie: cookie! } });
    const htmlEs = await mineEs.text();
    expect(titleOf(htmlEs)).toBe('TU CANTERO · Roble sauce');
    // The Spanish render carries no weekly-photo ask either.
    expect(htmlEs).not.toContain('SUBE LA FOTO DE ESTA SEMANA');
    expect(htmlEs).not.toContain('semanas seguidas con foto');
    for (const [path, expected] of [
      ['care', '¿Qué pasa? · Roble sauce'],
      ['adopt', 'Pon tu nombre · Roble sauce'],
    ] as const) {
      const page = await (await fetch(`${origin}/t/${TAG}/${path}?lang=es`)).text();
      expect(titleOf(page), path).toBe(expected);
    }
  });

  it("reads what a second neighbour said about the open report", async () => {
    // Two cookie-less presses are two identities (`/report` mints), so the
    // second adds weight rather than opening a duplicate. Their category and
    // their sentence must reach the person who has to go and fix it.
    const send = (body: string) =>
      fetch(`${origin}/t/${TAG}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
        body,
        redirect: 'manual',
      });
    expect((await send('category=litter&note=bolsas+en+la+esquina')).status).toBe(303);
    // The second neighbour pressed two tiles — the picker is multi-select.
    expect((await send('category=guard&category=thirsty&note=la+reja+est%C3%A1+doblada')).status).toBe(
      303,
    );

    const cookie = await stewardSession();
    const mine = await fetch(`${origin}/t/${TAG}/mine`, { headers: { cookie } });
    const html = await mine.text();
    expect(html).toContain('bolsas en la esquina');
    expect(html).toContain('la reja está doblada');
    // Both of the second neighbour's tiles reach the steward, not just one.
    expect(html).toContain(problemFor('guard').label.en);
    expect(html).toContain(problemFor('thirsty').label.en);
  });
});

describe('the language toggle, with no script running', () => {
  // fetch() runs no JavaScript, so everything below is what a no-JS visitor
  // gets: two plain links, the active language visibly selected, and a switch
  // that works by round trip alone. The inline script only makes it instant.
  it('shows both languages with the current one selected', async () => {
    const html = await (await fetch(`${origin}/t/${TAG}`)).text();
    const en = /<a[^>]*data-lang-choice="en"[^>]*>/.exec(html)?.[0];
    const es = /<a[^>]*data-lang-choice="es"[^>]*>/.exec(html)?.[0];
    expect(en).toBeTruthy();
    expect(es).toBeTruthy();
    expect(en).toContain('aria-current="true"');
    expect(es).not.toContain('aria-current');
    // The other side is a working link carrying `?lang=`, nothing more.
    expect(es).toContain(`href="/t/${TAG}?lang=es"`);
  });

  it('switches over the link alone, marks the other side, and remembers', async () => {
    const response = await fetch(`${origin}/t/${TAG}?lang=es`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<html lang="es"');
    const en = /<a[^>]*data-lang-choice="en"[^>]*>/.exec(html)?.[0];
    const es = /<a[^>]*data-lang-choice="es"[^>]*>/.exec(html)?.[0];
    expect(es).toContain('aria-current="true"');
    expect(en).not.toContain('aria-current');
    // The way back to English is the other segment's own link.
    expect(en).toContain('lang=en');
    // The choice survives the next tap on the next bed.
    expect(response.headers.getSetCookie().some((c) => c.startsWith('tg_lang=es'))).toBe(true);
  });
});
