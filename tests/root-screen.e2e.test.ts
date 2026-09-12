// The site root, against the real rendered HTML.
//
// The root redirects to the demo tag only while that binding still names a
// LIVE bed — the demo bed is retirable from the admin like any other, and a
// root that followed a retired binding would land on the calm "not assigned"
// screen, which answers 404 and would turn a pinned uptime check red on a
// delete nobody connected to the root. So the three states are proved here
// rather than reasoned about: a live demo bed redirects, a retired one gets
// the calm screen at 200 in both languages, and a store that cannot answer at
// all gets the same calm 200 rather than a 500.
//
// Slow by nature (a build plus a server), so it lives in the e2e suite.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seedData } from '../src/lib/store-dataset';
import { ROOT } from '../src/lib/copy';
import { DEMO_TAG_ID } from '../src/lib/tag-bindings';

const started: ChildProcessWithoutNullStreams[] = [];
const dirs: string[] = [];

async function startOn(
  data: Awaited<ReturnType<typeof seedData>> | null,
  env: Record<string, string> = {},
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'treebed-root-'));
  dirs.push(dir);
  if (data !== null) {
    await writeFile(path.join(dir, 'store.json'), JSON.stringify(data, null, 2), 'utf8');
  }
  const child = spawn(process.execPath, ['dist/server/entry.mjs'], {
    env: {
      ...process.env,
      TREEBED_SESSION_SECRET: 'e2e-secret-not-a-real-one',
      TREEBED_DATA_DIR: dir,
      HOST: '127.0.0.1',
      PORT: '0',
      ...env,
    },
  }) as ChildProcessWithoutNullStreams;
  started.push(child);
  let log = '';
  child.stderr.on('data', (buf: Buffer) => {
    log += String(buf);
  });
  return await new Promise<string>((resolve, reject) => {
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
}

beforeAll(() => {
  const built = spawnSync('npm', ['run', 'build'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (built.status !== 0) throw new Error(`build failed:\n${built.stdout}\n${built.stderr}`);
}, 180_000);

afterAll(async () => {
  for (const child of started) child.kill();
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe('the site root', () => {
  it('redirects to the demo tag while its bed is live', async () => {
    const origin = await startOn(await seedData());
    const response = await fetch(`${origin}/`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    // Flagged, so the demo bed does not count a monitor's poll as a tap.
    expect(response.headers.get('location')).toBe(`/t/${DEMO_TAG_ID}?tg_action=1`);
  }, 60_000);

  it('renders the calm screen at 200 when the demo bed has been retired', async () => {
    const data = await seedData();
    data.beds['BED-HRL-0847']!.retiredAt = '2026-09-11T12:00:00.000Z';
    const origin = await startOn(data);

    const response = await fetch(`${origin}/`, { redirect: 'manual' });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(ROOT.title.en);
    expect(html).toContain(ROOT.body.en);
    // Bilingual on the server render, with no script involved.
    expect(html).toContain(ROOT.title.es);

    const spanish = await (await fetch(`${origin}/?lang=es`)).text();
    expect(spanish).toContain(ROOT.title.es);
    expect(spanish).toContain(ROOT.body.es);
  }, 60_000);

  it('serves the calm screen rather than a 500 when the store cannot answer', async () => {
    // An unrecognized backend is refused by `createStore`, which is the
    // cheapest way to drive a store that throws on every read. Root traffic is
    // monitors and crawlers: a backend that is down must not read as the site
    // being down.
    const origin = await startOn(null, { TREEBED_STORE: 'nowhere' });
    const response = await fetch(`${origin}/`, { redirect: 'manual' });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(ROOT.title.en);
  }, 60_000);
});
