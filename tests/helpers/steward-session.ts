// How an e2e suite signs in as the seeded steward: the same emailed-link
// flow a real steward uses, driven end to end through the dev outbox the
// spawned server writes when no mail transport is configured. No shortcut
// through the store on purpose — what these suites hold is the shipped path.
//
// Callers memoize the cookie they get back: it lasts a year, and link
// requests are rate limited per email (service.ts), so asking once per
// server is also what a real steward does.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function signInByLink(origin: string, dataDir: string, tag: string): Promise<string> {
  const posted = await fetch(`${origin}/t/${tag}/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: 'email=seed-marisol%40example.invalid',
    redirect: 'manual',
  });
  if (posted.status !== 303) throw new Error(`link request answered ${posted.status}`);
  const outbox = path.join(dataDir, 'outbox');
  const newest = (await readdir(outbox)).sort().at(-1);
  if (!newest) throw new Error('the dev outbox holds no sign-in mail');
  const mail = JSON.parse(await readFile(path.join(outbox, newest), 'utf8')) as { text: string };
  const link = /https?:\/\/\S+\/signin\?\S+/.exec(mail.text)?.[0];
  if (!link) throw new Error('the sign-in mail carries no link');
  // The link's GET is an interstitial that spends nothing (mail scanners
  // prefetch links); the one-button POST behind it is what signs in.
  const opened = await fetch(link, { redirect: 'manual' });
  if (opened.status !== 200) throw new Error(`the sign-in interstitial answered ${opened.status}`);
  const token = new URL(link).searchParams.get('token') ?? '';
  const pressed = await fetch(`${origin}/t/${tag}/signin`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: new URLSearchParams({ token }).toString(),
    redirect: 'manual',
  });
  const set = pressed.headers.getSetCookie().find((cookie) => cookie.startsWith('tg_session='));
  if (!set) throw new Error(`sign-in press handed out no session cookie (${pressed.status})`);
  return set.split(';')[0]!;
}
