// The captain's named bed ids, against the real rendered HTML: /t/<id> works
// spelled exactly as the guard will carry it, the decorative /m suffix
// resolves to the same bed screen without the app reading it, a bed whose
// species is not yet recorded renders whole sentences in both languages on
// both doors and the About page, and the six earlier W 171st beds still
// answer on their old tags, untouched.
//
// Slow by nature (a build plus a server), so it lives in the e2e suite.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ABOUT,
  DOOR_STEWARDED,
  DOOR_UNSTEWARDED,
} from '../src/lib/copy';

/** A named S-run bed — seeded speciesless and open for adoption. */
const S_TAG = '1shfw171';
/** A named N-run metal-guard bed, whose chip will carry the /m suffix. */
const METAL_TAG = '1nhfw171';
/** A named bed left alone by this suite, for the door-1 render checks. */
const QUIET_TAG = '2shfw171';
/** The seeded demo tag — a stewarded, species-recorded bed. */
const DEMO_TAG = '2mq2amhv';
/** A real W 171st tag from before the named scheme. */
const OLD_TAG = 'jjhq9gfj';

let server: ChildProcessWithoutNullStreams;
let origin = '';
let dataDir = '';

beforeAll(async () => {
  const built = spawnSync('npm', ['run', 'build'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (built.status !== 0) throw new Error(`build failed:\n${built.stdout}\n${built.stderr}`);

  // The plain seed: the 22 run beds exactly as a fresh (or additively
  // upgraded) store holds them.
  dataDir = await mkdtemp(path.join(tmpdir(), 'treebed-named-'));
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

describe('the named URL, spelled as the captain spells it', () => {
  it('redirects the uppercase id off the guard to its lowercase canonical', async () => {
    const response = await fetch(`${origin}/t/1SHFW171?lang=es`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`/t/${S_TAG}?lang=es`);
  });

  it('renders door 1 with the adoption invitation — the run beds seed offered', async () => {
    const html = await (await fetch(`${origin}/t/${QUIET_TAG}`)).text();
    expect(html).toContain(DOOR_UNSTEWARDED.adopt.en);
    expect(html).toContain(`/t/${QUIET_TAG}/adopt`);
  });
});

describe('a bed whose species is not yet recorded', () => {
  it('reads as a whole sentence about the generic tree, in both languages', async () => {
    const html = await (await fetch(`${origin}/t/${QUIET_TAG}`)).text();
    // "This tree's bed is looking for a steward." — the frame plus the
    // generic word, split into leaves the language toggle can swap.
    expect(html).toContain(DOOR_UNSTEWARDED.headBefore.en);
    expect(html).toContain(DOOR_UNSTEWARDED.headAfter.en);
    expect(html).toMatch(/>tree<\/span>/);
    // The Spanish rides every leaf as data-es: the frame and "árbol".
    expect(html).toContain(DOOR_UNSTEWARDED.headAfter.es);
    expect(html).toContain('árbol');
    // No unrendered hole in the sentence: the species leaf holds a word,
    // never a stringified nothing.
    expect(html).not.toContain('>null<');
    expect(html).not.toContain('>undefined<');
  });

  it('states "not recorded" on the About page, where the species is an assertion', async () => {
    const html = await (await fetch(`${origin}/t/${QUIET_TAG}/about`)).text();
    expect(html).toContain(ABOUT.treeUnknown.en);
    expect(html).toContain(ABOUT.treeUnknown.es);
  });

  it('can be adopted, and door 2 then reads whole in both languages too', async () => {
    const posted = await fetch(`${origin}/t/${S_TAG}/adopt`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: new URLSearchParams({
        firstName: 'Dani',
        lastName: 'Torres',
        email: 'dani-e2e@example.invalid',
        phone: '',
        bedName: 'El Primero',
      }).toString(),
      redirect: 'manual',
    });
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toContain(`/t/${S_TAG}/adopted`);

    const html = await (await fetch(`${origin}/t/${S_TAG}`)).text();
    // "This tree bed has been adopted!" — the stewarded frame, generic word.
    expect(html).toContain(DOOR_STEWARDED.headAfter.en);
    expect(html).toContain(DOOR_STEWARDED.headAfter.es);
    expect(html).toMatch(/>tree<\/span>/);
    // The first steward named the bed; the name renders as typed.
    expect(html).toContain('El Primero');
  });
});

describe('the decorative /m suffix', () => {
  it('resolves to exactly the same bed screen as the bare URL', async () => {
    const response = await fetch(`${origin}/t/${METAL_TAG}/m`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`/t/${METAL_TAG}`);
  });

  it('carries the query string through, so a language choice survives the hop', async () => {
    const response = await fetch(`${origin}/t/${METAL_TAG}/m?lang=es`, { redirect: 'manual' });
    expect(response.headers.get('location')).toBe(`/t/${METAL_TAG}?lang=es`);
  });

  it('normalizes the whole chip spelling — uppercase id, uppercase M', async () => {
    const response = await fetch(`${origin}/t/1NHFW171/M`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`/t/${METAL_TAG}`);
  });

  it('is decoration only: a bed with no metal guard answers /m identically', async () => {
    // The app never reads the suffix against the guard field — the same
    // redirect comes back whatever the bed's guard says, which is what keeps
    // the chip and the record from drifting when a guard is replaced.
    const response = await fetch(`${origin}/t/${QUIET_TAG}/m`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`/t/${QUIET_TAG}`);
  });

  it('does not shadow /mine or any other named screen', async () => {
    // Without a session, /mine bounces to the door — never a decoration 404,
    // which is what a shadowed route would answer.
    const response = await fetch(`${origin}/t/${DEMO_TAG}/mine`, { redirect: 'manual' });
    expect([302, 303]).toContain(response.status);
    expect(response.headers.get('location')).toContain(`/t/${DEMO_TAG}`);
  });

  it('answers an unknown suffix with a plain 404, not a screen and not a 500', async () => {
    const response = await fetch(`${origin}/t/${METAL_TAG}/x`, { redirect: 'manual' });
    expect(response.status).toBe(404);
    // And an invalid id under a known decoration is not on the network at all.
    const invalid = await fetch(`${origin}/t/not-a-tag!/m`, { redirect: 'manual' });
    expect(invalid.status).toBe(404);
  });
});

describe('the six earlier W 171st beds', () => {
  it('still answer on their old opaque tags, unoffered and species-recorded', async () => {
    const response = await fetch(`${origin}/t/${OLD_TAG}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    // Willow oak, door 1, and still no adoption invitation: the captain has
    // not opened these six, and the named scheme changed nothing about them.
    // The door frame puts the species mid-sentence, so it reads lowercase
    // there whatever casing the stored row was written in, while the
    // standalone document title capitalizes at the render site.
    expect(html.replace(/<[^>]+>/g, '')).toContain('This willow oak');
    expect(html).toContain('<title>Willow oak · ');
    expect(html).not.toContain(DOOR_UNSTEWARDED.adopt.en);
  });
});
