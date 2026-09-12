// "About this bed", against the real rendered HTML: the bed's own profile in
// both languages, the small text link that reaches it from BOTH doors, and —
// because this is a new public screen — the same privacy proof every public
// screen is held to: no full name, no email, no phone, and never the plate.
//
// Slow by nature (a build plus a server), so it lives in the e2e suite.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seedData } from '../src/lib/store-dataset';
import { ABOUT, ABOUT_FAQ } from '../src/lib/copy';

/** The seeded demo tag (tag-bindings.ts), bound to the stewarded demo bed. */
const TAG = '2mq2amhv';
/** A real W 171st tag (tag-bindings.ts) — its bed seeds unoffered, so door 1. */
const DOOR1_TAG = 'jjhq9gfj';

/** What the admin typed onto the demo bed's profile for this run. */
const PLANTS_NOTE = 'Daffodils and a hosta along the guard side.';
const RECOMMENDED_NOTE = 'Native perennials — swamp milkweed does well here.';
const CARE_NOTE = 'Water twice a week through the summer.';

let server: ChildProcessWithoutNullStreams;
let origin = '';
let dataDir = '';

beforeAll(async () => {
  const built = spawnSync('npm', ['run', 'build'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (built.status !== 0) throw new Error(`build failed:\n${built.stdout}\n${built.stderr}`);

  // The store the server will find already there: the seeded adoption, with
  // the demo bed's profile filled in the way the block admin page would fill
  // it — a metal guard, plants in, a recommendation, and a care note.
  const data = await seedData();
  const demo = data.beds['BED-HRL-0847']!;
  demo.guard = 'metal';
  demo.plantsPresent = true;
  demo.plantsNote = PLANTS_NOTE;
  demo.plantingRecommended = true;
  demo.recommendedPlantsNote = RECOMMENDED_NOTE;
  demo.careNote = CARE_NOTE;

  dataDir = await mkdtemp(path.join(tmpdir(), 'treebed-about-'));
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

describe('reaching the page', () => {
  it('door 2 carries the small text link, not a third big button', async () => {
    const html = await (await fetch(`${origin}/t/${TAG}`)).text();
    // A ghost link, deliberately — the door keeps one clear question.
    expect(html).toMatch(new RegExp(`<a class="btn-ghost" href="/t/${TAG}/about"`));
    expect(html).toContain(ABOUT.fromDoor.en);
  });

  it('door 1 carries the same link', async () => {
    const html = await (await fetch(`${origin}/t/${DOOR1_TAG}`)).text();
    expect(html).toContain(`/t/${DOOR1_TAG}/about`);
    expect(html).toContain(ABOUT.fromDoor.en);
  });
});

describe('the profile, in both languages', () => {
  it('states every fact the admin keeps, with both languages on every leaf', async () => {
    const response = await fetch(`${origin}/t/${TAG}/about`);
    expect(response.status).toBe(200);
    const html = await response.text();

    // The public identity: NYC's number, never our plate.
    expect(html).toContain('#15850293');

    // The tree, present, named bilingually.
    expect(html).toContain('Willow oak');
    expect(html).toContain('Roble sauce');

    // The guard, as the admin set it: metal, in both languages.
    expect(html).toContain(ABOUT.guardMetal.en);
    expect(html).toContain(ABOUT.guardMetal.es);

    // The switches' answers.
    expect(html).toContain(ABOUT.plantsYes.en);
    expect(html).toContain(ABOUT.plantingYes.es);

    // The admin's typed notes, rendered as typed — once, with no
    // data-en/data-es pair: free text is never translated.
    for (const note of [PLANTS_NOTE, RECOMMENDED_NOTE, CARE_NOTE]) {
      expect(html.split(note)).toHaveLength(2);
    }

    // The FAQ and the city resources under it.
    expect(html).toContain(ABOUT_FAQ.stewardQ.en);
    expect(html).toContain(ABOUT_FAQ.stewardA.es);
    expect(html).toContain(ABOUT_FAQ.whoQ.es);
    expect(html).toContain('https://www.nycgovparks.org/trees');
    expect(html).toContain('https://portal.311.nyc.gov/');
  });

  it('renders Spanish as the active language when asked', async () => {
    const html = await (await fetch(`${origin}/t/${TAG}/about?lang=es`)).text();
    expect(html).toContain('<html lang="es"');
    expect(html).toContain(ABOUT.title.es);
  });

  it('answers the profile defaults honestly on an untouched bed', async () => {
    // The W 171st beds seed with the defaults: no guard on record, a tree
    // standing, nothing planted, no recommendation, no notes.
    const html = await (await fetch(`${origin}/t/${DOOR1_TAG}/about`)).text();
    expect(html).toContain(ABOUT.guardNone.en);
    expect(html).toContain(ABOUT.plantsNo.en);
    expect(html).toContain(ABOUT.plantingNo.es);
    expect(html).toContain(ABOUT.careNone.en);
  });
});

describe('what the page must never leak', () => {
  it('shows no PII and no plate, in either language', async () => {
    for (const url of [`${origin}/t/${TAG}/about`, `${origin}/t/${TAG}/about?lang=es`]) {
      const html = await (await fetch(url)).text();
      // Our internal plate is a join key, never a public identity.
      expect(html).not.toContain('BED-HRL-0847');
      // The seeded steward's PII: full name, email, phone — admin-only.
      expect(html).not.toContain('Marisol');
      expect(html).not.toContain('Rivera');
      expect(html).not.toContain('example.invalid');
      expect(html).not.toContain('555 010');
    }
  });
});
