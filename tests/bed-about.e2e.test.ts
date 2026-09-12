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
/** Another real W 171st tag, whose bed keeps the seeded profile: nothing recorded at all. */
const UNRECORDED_TAG = '1hc0t9cj';

/** What the admin typed onto the demo bed's profile for this run. */
const PLANTS_NOTE = 'Daffodils and a hosta along the guard side.';
const RECOMMENDED_NOTE = 'Native perennials — swamp milkweed does well here.';
const CARE_NOTE = 'Water twice a week through the summer.';
/** Notes left on the W 171st door-1 bed's record with both switches OFF. */
const OFF_PLANTS_NOTE = 'Tulips that came out last spring.';
const OFF_RECOMMENDED_NOTE = 'Nothing until the guard is in.';

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
  demo.treePresent = true;
  demo.plantsPresent = true;
  demo.plantsNote = PLANTS_NOTE;
  demo.plantingRecommended = true;
  demo.recommendedPlantsNote = RECOMMENDED_NOTE;
  demo.careNote = CARE_NOTE;
  // The door-1 bed keeps typed notes under switches the admin set to "no",
  // and is the empty pit: a tree recorded as not standing.
  const door1 = data.beds['BED-WH-1711']!;
  door1.treePresent = false;
  door1.plantsPresent = false;
  door1.plantsNote = OFF_PLANTS_NOTE;
  door1.plantingRecommended = false;
  door1.recommendedPlantsNote = OFF_RECOMMENDED_NOTE;

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

    // The tree, named bilingually, and recorded as standing — the fact the
    // admin entered, stated rather than left to the species line.
    expect(html).toContain('Willow oak');
    expect(html).toContain('Roble sauce');
    expect(html).toContain(ABOUT.treeStanding.en);
    expect(html).toContain(ABOUT.treeStanding.es);

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

  it('states a recorded "no" plainly, and nothing at all about what nobody recorded', async () => {
    // The door-1 bed has both facts recorded as "no" by the admin, so the
    // page says so — and the guard, which nobody has recorded, is absent:
    // neither a material nor "none", which would deny a guard the tag rides.
    const html = await (await fetch(`${origin}/t/${DOOR1_TAG}/about`)).text();
    expect(html).not.toContain(ABOUT.guardLabel.en);
    expect(html).not.toContain(ABOUT.guardNone.en);
    expect(html).toContain(ABOUT.plantsNo.en);
    expect(html).toContain(ABOUT.plantingNo.es);
    expect(html).toContain(ABOUT.careNone.en);
  });

  it('says nothing about a bed nobody has recorded rather than answering for it', async () => {
    // The seeded default is NOT YET RECORDED for the plants and the planting
    // recommendation, exactly as for the guard: a whole block reading "nothing
    // planted yet" and "check with Trash Talk before planting here" on the day
    // it goes live would be the page asserting facts nobody entered.
    const html = await (await fetch(`${origin}/t/${UNRECORDED_TAG}/about`)).text();
    expect(html).not.toContain(ABOUT.plantsLabel.en);
    expect(html).not.toContain(ABOUT.plantsNo.en);
    expect(html).not.toContain(ABOUT.plantingLabel.en);
    expect(html).not.toContain(ABOUT.plantingNo.en);
    expect(html).not.toContain(ABOUT.plantingYes.en);
    // The tree follows the same rule: neither statement until somebody says.
    expect(html).not.toContain(ABOUT.treeStanding.en);
    expect(html).not.toContain(ABOUT.noTree.en);
    // What the page does still state: the species it is the bed for, and the
    // care line.
    expect(html).toContain(ABOUT.treeLabel.en);
    expect(html).toContain('Willow oak');
    expect(html).toContain(ABOUT.careNone.en);
  });

  it('names the species even where no tree is standing, so the doors are not contradicted', async () => {
    // Both doors one tap away headline the species. An empty pit says what is
    // missing beside the species rather than instead of it.
    const html = await (await fetch(`${origin}/t/${DOOR1_TAG}/about`)).text();
    expect(html).toContain('Willow oak');
    expect(html).toContain('Roble sauce');
    expect(html).toContain(ABOUT.noTree.en);
    expect(html).toContain(ABOUT.noTree.es);
  });

  it('shows a typed note only under the switch it describes', async () => {
    // A note kept on the record while its switch is off (the admin never
    // loses the words) must not contradict the switch out loud.
    const html = await (await fetch(`${origin}/t/${DOOR1_TAG}/about`)).text();
    expect(html).not.toContain(OFF_PLANTS_NOTE);
    expect(html).not.toContain(OFF_RECOMMENDED_NOTE);
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
