// The whole sign-in-by-link flow, against the real rendered app: ask for a
// link, read it out of the dev outbox (no mail transport is configured, so
// nothing can be sent anywhere), open it, land signed in on the steward's
// view. Also the negative space the captain's decision demands: the token
// appears in no response and no server log, a spent or foreign link answers
// one calm screen, and the unsubscribe link flips exactly one flag.
//
// Slow by nature (a build plus a server), so it lives in the e2e suite.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unsubscribePath } from '../src/lib/digest';
import { seedData } from '../src/lib/store-dataset';

/** The seeded demo tag (tag-bindings.ts), bound to the seeded bed BED-HRL-0847. */
const TAG = '2mq2amhv';
/** A second bound tag (a real W 171st bed) — the wrong door for a demo-bed link. */
const OTHER_TAG = 'jjhq9gfj';
const EMAIL = 'seed-marisol@example.invalid';
const SECRET = 'e2e-secret-not-a-real-one';

let server: ChildProcessWithoutNullStreams;
let origin = '';
let dataDir = '';
let serverSaid = () => '';

beforeAll(async () => {
  const built = spawnSync('npm', ['run', 'build'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (built.status !== 0) throw new Error(`build failed:\n${built.stdout}\n${built.stderr}`);

  dataDir = await mkdtemp(path.join(tmpdir(), 'treebed-signin-'));
  const child = spawn(process.execPath, ['dist/server/entry.mjs'], {
    env: {
      ...process.env,
      TREEBED_SESSION_SECRET: SECRET,
      TREEBED_DATA_DIR: dataDir,
      HOST: '127.0.0.1',
      PORT: '0',
    },
  }) as ChildProcessWithoutNullStreams;
  // Everything the server says, both streams: the "never log the token"
  // assertion reads this after the flow has run.
  let log = '';
  child.stderr.on('data', (buf: Buffer) => {
    log += String(buf);
  });
  serverSaid = () => log;
  origin = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server never reported a port')), 30_000);
    child.stdout.on('data', (buf: Buffer) => {
      log += String(buf);
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

async function outboxFiles(): Promise<string[]> {
  try {
    return (await readdir(path.join(dataDir, 'outbox'))).sort();
  } catch {
    return [];
  }
}

async function requestLink(email: string): Promise<Response> {
  return fetch(`${origin}/t/${TAG}/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: `email=${encodeURIComponent(email)}`,
    redirect: 'manual',
  });
}

async function newestMail(): Promise<{ text: string; html: string; subject: string }> {
  const files = await outboxFiles();
  const newest = files.at(-1);
  if (!newest) throw new Error('the dev outbox is empty');
  return JSON.parse(await readFile(path.join(dataDir, 'outbox', newest), 'utf8')) as {
    text: string;
    html: string;
    subject: string;
  };
}

function linkFrom(mail: { text: string }): string {
  const link = /https?:\/\/\S+\/signin\?\S+/.exec(mail.text)?.[0];
  if (!link) throw new Error('the sign-in mail carries no link');
  return link;
}

describe('signing in by emailed link', () => {
  let link = '';
  let token = '';

  it('answers "check your inbox" and puts the link in the outbox, never in the response', async () => {
    const posted = await requestLink(EMAIL);
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe(`/t/${TAG}/auth?sent=1`);
    const mail = await newestMail();
    link = linkFrom(mail);
    token = new URL(link).searchParams.get('token')!;
    expect(token.length).toBeGreaterThanOrEqual(43);
    // The link resolves against the server's own origin (the dev fallback for
    // TREEBED_PUBLIC_ORIGIN) and the bed the request came from.
    expect(link.startsWith(`${origin}/t/${TAG}/signin?`)).toBe(true);
    // The redirect target renders the calm sent screen, token-free.
    const sentScreen = await (await fetch(`${origin}/t/${TAG}/auth?sent=1`)).text();
    expect(sentScreen).toContain('Check your inbox');
    expect(sentScreen).not.toContain(token);
  });

  it('answers an unknown email identically, and sends nothing', async () => {
    const before = (await outboxFiles()).length;
    const posted = await requestLink('nobody@example.com');
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe(`/t/${TAG}/auth?sent=1`);
    expect((await outboxFiles()).length).toBe(before);
  });

  it('refuses the link at a different bed without burning it', async () => {
    const wrongDoor = link.replace(`/t/${TAG}/`, `/t/${OTHER_TAG}/`);
    const opened = await fetch(wrongDoor, { redirect: 'manual' });
    expect(opened.status).toBe(410);
    expect(opened.headers.getSetCookie().some((c) => c.startsWith('tg_session='))).toBe(false);
  });

  it('signs the steward in once, landing on their own view', async () => {
    const opened = await fetch(link, { redirect: 'manual' });
    expect(opened.status).toBe(303);
    expect(opened.headers.get('location')).toBe(`/t/${TAG}/mine`);
    const session = opened.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('tg_session='));
    expect(session).toBeDefined();
    const mine = await fetch(`${origin}/t/${TAG}/mine`, {
      headers: { cookie: session!.split(';')[0]! },
      redirect: 'manual',
    });
    expect(mine.status).toBe(200);
    expect(await mine.text()).toContain('@marisol_r');
  });

  it('finds the link spent on a second open — single use, one calm answer', async () => {
    const reopened = await fetch(link, { redirect: 'manual' });
    expect(reopened.status).toBe(410);
    expect(reopened.headers.getSetCookie().some((c) => c.startsWith('tg_session='))).toBe(false);
    const html = await reopened.text();
    expect(html).toContain('doesn’t work any more');
    // The remedy is offered in place: ask for a fresh link.
    expect(html).toContain(`/t/${TAG}/auth`);
  });

  it('has written the token to no log and no store file', async () => {
    expect(token).not.toBe('');
    expect(serverSaid()).not.toContain(token);
    const store = await readFile(path.join(dataDir, 'store.json'), 'utf8');
    expect(store).not.toContain(token);
  });
});

describe('the one-click unsubscribe', () => {
  it('flips the steward’s digest off and says so in both languages', async () => {
    // Signed with the same secret the server holds, exactly as the digest
    // builder signs it.
    process.env.TREEBED_SESSION_SECRET = SECRET;
    const linkPath = unsubscribePath(seedData().users['user-marisol']!);
    const opened = await fetch(`${origin}${linkPath}`, { redirect: 'manual' });
    expect(opened.status).toBe(200);
    const html = await opened.text();
    expect(html).toContain('unsubscribed');
    expect(html).toContain('data-es=');
    const store = JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8')) as {
      users: Record<string, { digestOptedOut: boolean }>;
    };
    expect(store.users['user-marisol']!.digestOptedOut).toBe(true);
  });

  it('refuses a tampered link in plain text, touching nothing', async () => {
    const opened = await fetch(`${origin}/digest/unsubscribe?u=user-marisol&s=forged`, {
      redirect: 'manual',
    });
    expect(opened.status).toBe(404);
    expect(await opened.text()).toBe('Not a valid link.');
  });
});
