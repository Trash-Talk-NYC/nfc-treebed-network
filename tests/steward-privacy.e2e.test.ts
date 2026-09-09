// A steward who asked not to be named, against the real rendered screen.
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
import { DOOR_STEWARDED, DOOR_UNSTEWARDED, COMMON } from '../src/lib/copy';

/** The seeded demo tag (tag-bindings.ts), bound to the seeded bed BED-HRL-0847. */
const TAG = '2mq2amhv';

let server: ChildProcessWithoutNullStreams;
let origin = '';
let dataDir = '';

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
  const data = await seedData();
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
    // the clear button and the weekly photo.
    const signedIn = await fetch(`${origin}/t/${TAG}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: 'username=marisol_r&pin=1234',
      redirect: 'manual',
    });
    const cookie = signedIn.headers
      .getSetCookie()
      .find((c) => c.startsWith('tg_session='))
      ?.split(';')[0];
    expect(cookie, `sign-in handed out no session (${signedIn.status})`).toBeTruthy();

    const mine = await fetch(`${origin}/t/${TAG}/mine`, { headers: { cookie: cookie! } });
    expect(mine.status).toBe(200);
    const html = await mine.text();
    expect(html).toContain('marisol_r');
    expect(html).toContain('M. R.');
  });
});
