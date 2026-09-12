// The bed's given name, against the real rendered HTML.
//
// "The first adopter names the bed" — and the name is visitor-supplied free
// text on a public screen, rendered AS TYPED in both languages, never spliced
// into a bilingual sentence. The proof has to be the HTML a passer-by
// receives, on both language paths, and the other half matters just as much:
// a bed with no name renders no name element at all — no empty label, no
// "Unnamed" — and a form in front of anyone but the first steward carries no
// naming field.
//
// Slow by nature (a build plus a server), so it lives in the e2e suite.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serverEnv } from './helpers/server-env';
import { seedData } from '../src/lib/store-dataset';
import { ADOPT } from '../src/lib/copy';

/** The seeded demo tag: bound to BED-HRL-0847, which marisol already stewards. */
const STEWARDED_TAG = '2mq2amhv';
/** BED-WH-1712's tag (tag-bindings.ts): seeded empty, offered below by hand. */
const OPEN_TAG = '1hc0t9cj';
/** BED-WH-1711's tag: seeded empty AND unoffered — the untouched control. */
const UNNAMED_TAG = 'jjhq9gfj';

/** As the steward typed it — deliberately not a word either language owns. */
const GIVEN_NAME = 'La Madrina';

let server: ChildProcessWithoutNullStreams;
let origin = '';
let dataDir = '';

beforeAll(async () => {
  const built = spawnSync('npm', ['run', 'build'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (built.status !== 0) throw new Error(`build failed:\n${built.stdout}\n${built.stderr}`);

  dataDir = await mkdtemp(path.join(tmpdir(), 'treebed-bed-name-'));
  const data = seedData();
  // The stewarded demo bed carries a name, as if its first steward gave one.
  data.beds['BED-HRL-0847']!.bedName = GIVEN_NAME;
  // One empty W 171st bed offered, so its adopt form fronts a FIRST steward.
  data.beds['BED-WH-1712']!.offeredSlots = 1;
  await writeFile(path.join(dataDir, 'store.json'), JSON.stringify(data, null, 2), 'utf8');

  const child = spawn(process.execPath, ['dist/server/entry.mjs'], {
    env: serverEnv({
      TREEBED_SESSION_SECRET: 'e2e-secret-not-a-real-one',
      TREEBED_DATA_DIR: dataDir,
      HOST: '127.0.0.1',
      PORT: '0',
    }),
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

describe('the name on the public screens', () => {
  it('engraves the given name on door 2, as typed, on both language paths', async () => {
    for (const search of ['', '?lang=es']) {
      const html = await (await fetch(`${origin}/t/${STEWARDED_TAG}${search}`)).text();
      // As typed, its own leaf: quoted, and never inside a data-en/data-es
      // pair — the toggle has nothing to swap on a name.
      expect(html).toContain(`“${GIVEN_NAME}”`);
      expect(html).not.toContain(`data-en="${GIVEN_NAME}`);
      expect(html).not.toContain(`data-es="${GIVEN_NAME}`);
      expect(html).toContain('class="bed-name"');
    }
  });

  it('renders an unnamed bed with no name element at all', async () => {
    for (const search of ['', '?lang=es']) {
      const html = await (await fetch(`${origin}/t/${UNNAMED_TAG}${search}`)).text();
      // The class also names a style rule in the inlined stylesheet, so the
      // assertion anchors to the attribute: no ELEMENT renders.
      expect(html).not.toContain('class="bed-name"');
      expect(html).not.toContain('Unnamed');
    }
  });
});

describe('the naming moment on the adopt form', () => {
  it('offers naming to the first steward, in both languages', async () => {
    for (const [search, lang] of [
      ['', 'en'],
      ['?lang=es', 'es'],
    ] as const) {
      const html = await (await fetch(`${origin}/t/${OPEN_TAG}/adopt${search}`)).text();
      expect(html).toContain('name="bedName"');
      expect(html).toContain(ADOPT.nameBed[lang]);
      expect(html).toContain(ADOPT.nameBedHelp[lang]);
    }
  });

  it('does not ask a second steward: the stewarded bed’s form has no naming field', async () => {
    const html = await (await fetch(`${origin}/t/${STEWARDED_TAG}/adopt`)).text();
    // The form itself is there — the demo bed has an open second slot.
    expect(html).toContain('name="firstName"');
    expect(html).not.toContain('name="bedName"');
    expect(html).not.toContain(ADOPT.nameBed.en);
  });

  it('carries a first steward’s name through the POST and onto the door', async () => {
    const posted = await fetch(`${origin}/t/${OPEN_TAG}/adopt`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: new URLSearchParams({
        firstName: 'Rita',
        lastName: 'Okafor',
        email: 'r.okafor@example.com',
        phone: '',
        bedName: 'El Robledal',
      }).toString(),
      redirect: 'manual',
    });
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toContain(`/t/${OPEN_TAG}/adopted`);
    for (const search of ['', '?lang=es']) {
      const html = await (await fetch(`${origin}/t/${OPEN_TAG}${search}`)).text();
      expect(html).toContain('“El Robledal”');
    }
  });
});
