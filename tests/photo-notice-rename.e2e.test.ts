// The captain's 2026-09-12 asks, against a real server: a care photo that is
// STORED and shown to the admin (with the delete that accepting uploads
// obliges), an applause that reaches the steward's inbox once a day — queued
// at the press and delivered by the scheduled run, never in front of the
// visitor's redirect — and a
// bed renamed from the steward's own view. All driven the way the street
// drives them — real POSTs, the dev outbox, the rendered HTML — because each
// one crosses the seam between a route, the store, and a screen.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { copyFile, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runApplauseNotices } from '../src/lib/digest';
import { ADMIN_EARLIER_PHOTOS_SHOWN } from '../src/lib/service';
import { LocalStore } from '../src/lib/store-local';
import { serverEnv } from './helpers/server-env';
import { signInByLink } from './helpers/steward-session';

const ADMIN_KEY = 'e2e-admin-key-with-plenty-of-entropy';
const TAG = '2mq2amhv';
const PLATE = 'BED-HRL-0847';
const DEMO_BLOCK_PATH = '/admin/blocks/w-138-acp-demo';
const BOUNDARY = '----treebede2e';

let server: ChildProcessWithoutNullStreams;
let origin = '';
let dataDir = '';

beforeAll(async () => {
  const built = spawnSync('npm', ['run', 'build'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (built.status !== 0) throw new Error(`build failed:\n${built.stdout}\n${built.stderr}`);

  dataDir = await mkdtemp(path.join(tmpdir(), 'treebed-photo-'));
  // The scheduled-run half below signs an unsubscribe link in THIS process,
  // so it keys off the same secret the server was handed.
  process.env.TREEBED_SESSION_SECRET ??= 'e2e-secret-not-a-real-one';
  const child = spawn(process.execPath, ['dist/server/entry.mjs'], {
    env: serverEnv({
      TREEBED_SESSION_SECRET: 'e2e-secret-not-a-real-one',
      TREEBED_ADMIN_KEY: ADMIN_KEY,
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

interface StoredData {
  reports: Array<{ id: string; photoAttached: boolean; closedAt: string | null }>;
  photos: Array<{ id: string; reportId: string; bedPlate: string; contentType: string; bytes: number }>;
  events: Array<{ eventType: string; actorId: string | null; note: string }>;
  beds: Record<
    string,
    { bedName: string | null; applauseNoticeAt: string | null; applauseNoticeDueAt: string | null }
  >;
}

async function storedData(): Promise<StoredData> {
  return JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8')) as StoredData;
}

/** Every mail in the dev outbox with this subject. */
async function outboxWithSubject(subject: string): Promise<Array<{ to: { email: string }; text: string; headers?: Record<string, string> }>> {
  const outbox = path.join(dataDir, 'outbox');
  const files = await readdir(outbox).catch(() => [] as string[]);
  const mails = await Promise.all(
    files.map(async (file) =>
      JSON.parse(await readFile(path.join(outbox, file), 'utf8')) as {
        subject: string;
        to: { email: string };
        text: string;
        headers?: Record<string, string>;
      },
    ),
  );
  return mails.filter((m) => m.subject === subject);
}

/** The visitor identity a neighbour at the tag has — the plaque GET mints it. */
async function visitorCookie(): Promise<string> {
  const plaque = await fetch(`${origin}/t/${TAG}`);
  const set = plaque.headers.getSetCookie().find((cookie) => cookie.startsWith('tg_visitor='));
  if (!set) throw new Error('the plaque handed out no visitor cookie');
  return set.split(';')[0]!;
}

/** Sign in through the real key form and hand back the admin session cookie. */
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

let cachedStewardCookie: string | null = null;
async function stewardCookie(): Promise<string> {
  cachedStewardCookie ??= await signInByLink(origin, dataDir, TAG);
  return cachedStewardCookie;
}

/** The care form's multipart body: category, note, then the photo — DOM order. */
function photoReportBody(category: string, photoBytes: number): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="category"\r\n\r\n' +
        `${category}\r\n` +
        `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="photo"; filename="tree.jpg"\r\n' +
        'Content-Type: image/jpeg\r\n\r\n',
    ),
    Buffer.alloc(photoBytes, 0x7f),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
}

/** How many photos the admin panel actually draws as pixels on a render. */
function drawnPhotos(html: string): number {
  return (html.match(/src="\/admin\/photos\//g) ?? []).length;
}

describe('the stored care photo', () => {
  const PHOTO_BYTES = 64 * 1024;
  let photoId = '';

  it('stores the photo a filed report carries — bytes on disk, row in the record', async () => {
    const posted = await fetch(`${origin}/t/${TAG}/report`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, origin },
      body: new Uint8Array(photoReportBody('litter', PHOTO_BYTES)),
      redirect: 'manual',
    });
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe(`/t/${TAG}/thanks`);

    const data = await storedData();
    expect(data.photos).toHaveLength(1);
    const photo = data.photos[0]!;
    photoId = photo.id;
    const report = data.reports.find((r) => r.closedAt === null)!;
    expect(photo.reportId).toBe(report.id);
    expect(photo.bedPlate).toBe(PLATE);
    expect(photo.contentType).toBe('image/jpeg');
    expect(photo.bytes).toBe(PHOTO_BYTES);
    expect(report.photoAttached).toBe(true);
    // The bytes themselves, beside the store file — exactly the upload's.
    const blob = await stat(path.join(dataDir, 'photos', photo.id));
    expect(blob.size).toBe(PHOTO_BYTES);
  });

  it('serves the photo to the admin session alone, as pixels and never as markup', async () => {
    // No session: off to the key screen, like every admin route.
    const refused = await fetch(`${origin}/admin/photos/${photoId}`, { redirect: 'manual' });
    expect(refused.status).toBe(302);
    expect(refused.headers.get('location')).toBe('/admin');

    const cookie = await adminCookie();
    const served = await fetch(`${origin}/admin/photos/${photoId}`, { headers: { cookie } });
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/jpeg');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await served.arrayBuffer()).byteLength).toBe(PHOTO_BYTES);
  });

  it('shows the photo in the opened bed panel, beside the open report', async () => {
    const cookie = await adminCookie();
    const page = await fetch(`${origin}${DEMO_BLOCK_PATH}?bed=${PLATE}`, { headers: { cookie } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(`/admin/photos/${photoId}`);
    expect(html).toContain('DELETE PHOTO');
  });

  it('keeps the photo off every public and steward screen', async () => {
    for (const [page, headers] of [
      ['', {}],
      ['about', {}],
      ['mine', { cookie: await stewardCookie() }],
    ] as const) {
      const html = await (await fetch(`${origin}/t/${TAG}/${page}`, { headers })).text();
      expect(html).not.toContain('/admin/photos/');
      expect(html).not.toContain(photoId);
    }
  });

  it('deletes only through the confirmation page’s own POST, for good', async () => {
    const cookie = await adminCookie();
    // The panel's link opens the confirmation; opening it deletes nothing.
    const confirm = await fetch(`${origin}${DEMO_BLOCK_PATH}/delete-photo?photo=${photoId}`, {
      headers: { cookie },
    });
    expect(confirm.status).toBe(200);
    expect(await confirm.text()).toContain('DELETE THIS PHOTO');
    expect((await storedData()).photos).toHaveLength(1);

    const posted = await fetch(`${origin}${DEMO_BLOCK_PATH}/delete-photo?photo=${photoId}`, {
      method: 'POST',
      headers: { cookie, origin },
      redirect: 'manual',
    });
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe(`${DEMO_BLOCK_PATH}?bed=${PLATE}&photodeleted=1`);

    const data = await storedData();
    expect(data.photos).toHaveLength(0);
    // The report and its flag stay — what the neighbour said was not what was
    // moderated — while the bytes are gone for good.
    expect(data.reports.find((r) => r.closedAt === null)!.photoAttached).toBe(true);
    await expect(stat(path.join(dataDir, 'photos', photoId))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const gone = await fetch(`${origin}/admin/photos/${photoId}`, { headers: { cookie } });
    expect(gone.status).toBe(404);
  });

  it('takes no delete from a caller with no session', async () => {
    // Refile a photo so there is something to refuse deleting.
    const second = await fetch(`${origin}/t/${TAG}/report`, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
        origin,
        cookie: await visitorCookie(),
      },
      body: new Uint8Array(photoReportBody('guard', 1024)),
      redirect: 'manual',
    });
    expect(second.status).toBe(303);
    const kept = (await storedData()).photos;
    expect(kept).toHaveLength(1);

    const refused = await fetch(`${origin}${DEMO_BLOCK_PATH}/delete-photo?photo=${kept[0]!.id}`, {
      method: 'POST',
      headers: { origin },
      redirect: 'manual',
    });
    expect(refused.status).toBe(303);
    expect(refused.headers.get('location')).toBe('/admin');
    expect((await storedData()).photos).toHaveLength(1);
  });
});

describe('the applause notice', () => {
  const SUBJECT = 'Someone applauded your tree bed';

  it('queues on the day’s first counted applause, mails nothing at the press, and goes out on the scheduled run', async () => {
    const first = await fetch(`${origin}/t/${TAG}/applause`, {
      method: 'POST',
      headers: { origin, cookie: await visitorCookie() },
      redirect: 'manual',
    });
    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toBe(`/t/${TAG}/thanks?applause=1`);
    // Nobody standing at a tree waits on a mail call: the press claims the
    // day and queues the notice, and the outbox is still empty.
    expect(await outboxWithSubject(SUBJECT)).toHaveLength(0);
    const claimed = (await storedData()).beds[PLATE]!;
    expect(claimed.applauseNoticeAt).not.toBeNull();
    expect(claimed.applauseNoticeDueAt).not.toBeNull();

    // A second neighbour the same NY day: counted, and the queue is unchanged
    // — one notice per bed per NY day however many people applaud.
    const second = await fetch(`${origin}/t/${TAG}/applause`, {
      method: 'POST',
      headers: { origin, cookie: await visitorCookie() },
      redirect: 'manual',
    });
    expect(second.status).toBe(303);
    expect(await outboxWithSubject(SUBJECT)).toHaveLength(0);

    // The delivery half, the way the scheduled function drives it — over a
    // COPY of the store the server just wrote, because the running server
    // holds the dataset in memory and two writers to one file is not a thing
    // this suite should invent. The send is injected, so no transport of any
    // kind is involved.
    const copied = path.join(dataDir, 'scheduled-run.json');
    await copyFile(path.join(dataDir, 'store.json'), copied);
    const store = new LocalStore(copied);
    const sent: Array<{ to: { email: string }; subject: string; text: string; headers?: Record<string, string> }> = [];
    const run = await runApplauseNotices(store, {
      origin: 'https://example.org',
      send: async (message) => {
        sent.push(message);
        return { ok: true, transport: 'outbox' };
      },
    });
    expect(run).toEqual({ sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe(SUBJECT);
    expect(sent[0]!.to.email).toBe('seed-marisol@example.invalid');
    expect(sent[0]!.text).toContain(`/t/${TAG}/mine`);
    // The same one-click unsubscribe the digest carries — one flag, every mail.
    expect(sent[0]!.headers?.['List-Unsubscribe']).toContain('/digest/unsubscribe');
    // Claim-then-send: the queue is empty, so a rerun mails nothing.
    expect(await runApplauseNotices(store, { origin: 'https://example.org', send: async () => ({ ok: true, transport: 'outbox' }) })).toEqual({
      sent: 0,
      failed: 0,
    });
  });
});

describe('renaming the bed from the steward view', () => {
  it('renders the rename form on the steward’s own view', async () => {
    const html = await (
      await fetch(`${origin}/t/${TAG}/mine`, { headers: { cookie: await stewardCookie() } })
    ).text();
    expect(html).toContain(`action="/t/${TAG}/rename"`);
    expect(html).toContain('SAVE THE NAME');
    // Bilingual like everything else on the screen.
    expect(html).toContain('data-es="GUARDAR EL NOMBRE"');
  });

  it('renames on the POST, shows it everywhere, and writes the trail event', async () => {
    const posted = await fetch(`${origin}/t/${TAG}/rename`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin,
        cookie: await stewardCookie(),
      },
      body: new URLSearchParams({ name: 'La Madrina de Harlem' }).toString(),
      redirect: 'manual',
    });
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe(`/t/${TAG}/mine?renamed=1`);

    const data = await storedData();
    expect(data.beds[PLATE]!.bedName).toBe('La Madrina de Harlem');
    const trail = data.events.filter((e) => e.eventType === 'rename');
    expect(trail).toHaveLength(1);
    expect(trail[0]!.note).toBe('La Madrina de Harlem');
    expect(trail[0]!.actorId).toBe('user-marisol');

    // The name is the bed's, on its screens: the door and the steward view.
    const door = await (await fetch(`${origin}/t/${TAG}`)).text();
    expect(door).toContain('La Madrina de Harlem');
    const mine = await (
      await fetch(`${origin}/t/${TAG}/mine`, { headers: { cookie: await stewardCookie() } })
    ).text();
    expect(mine).toContain('La Madrina de Harlem');
  });

  it('takes no rename from a visitor or an empty field', async () => {
    const stranger = await fetch(`${origin}/t/${TAG}/rename`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin,
        cookie: await visitorCookie(),
      },
      body: new URLSearchParams({ name: 'Mine Now' }).toString(),
      redirect: 'manual',
    });
    expect(stranger.status).toBe(303);
    expect(stranger.headers.get('location')).toBe(`/t/${TAG}?tg_action=1`);

    const empty = await fetch(`${origin}/t/${TAG}/rename`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin,
        cookie: await stewardCookie(),
      },
      body: new URLSearchParams({ name: '   ' }).toString(),
      redirect: 'manual',
    });
    expect(empty.status).toBe(303);
    expect(empty.headers.get('location')).toBe(`/t/${TAG}/mine?rename=empty`);

    expect((await storedData()).beds[PLATE]!.bedName).toBe('La Madrina de Harlem');
  });
});

describe('the bed’s earlier photos', () => {
  it('draws the most recent few and puts the rest behind a link that needs no script', async () => {
    const steward = await stewardCookie();
    const clear = async (): Promise<void> => {
      const closed = await fetch(`${origin}/t/${TAG}/clear`, {
        method: 'POST',
        headers: { origin, cookie: steward },
        redirect: 'manual',
      });
      expect(closed.status).toBe(303);
    };
    const fileWithPhoto = async (): Promise<void> => {
      const filed = await fetch(`${origin}/t/${TAG}/report`, {
        method: 'POST',
        headers: {
          'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
          origin,
          cookie: await visitorCookie(),
        },
        body: new Uint8Array(photoReportBody('litter', 512)),
        redirect: 'manual',
      });
      expect(filed.status).toBe(303);
    };

    // Every photo on the bed into the history: a photo stays with its report,
    // and a closed report's photos are what the panel caps.
    await clear();
    for (let i = 0; i < ADMIN_EARLIER_PHOTOS_SHOWN; i += 1) {
      await fileWithPhoto();
      await clear();
    }
    const earlier = (await storedData()).photos.length;
    expect(earlier).toBeGreaterThan(ADMIN_EARLIER_PHOTOS_SHOWN);

    const cookie = await adminCookie();
    const capped = await (
      await fetch(`${origin}${DEMO_BLOCK_PATH}?bed=${PLATE}`, { headers: { cookie } })
    ).text();
    expect(drawnPhotos(capped)).toBe(ADMIN_EARLIER_PHOTOS_SHOWN);
    expect(capped).toContain('Show older photos');
    expect(capped).toContain('photos=all');

    // The reveal is a plain link the server reads, and every photo it draws
    // keeps its delete: moderation does not expire with the cap.
    const all = await (
      await fetch(`${origin}${DEMO_BLOCK_PATH}?bed=${PLATE}&photos=all`, { headers: { cookie } })
    ).text();
    expect(drawnPhotos(all)).toBe(earlier);
    expect(all.match(/delete-photo\?photo=/g) ?? []).toHaveLength(earlier);
    expect(all).not.toContain('Show older photos');

    // The reveal survives the whole delete round-trip: moderating a long
    // history must not collapse back to the capped few between one photo and
    // the next.
    const revealed = all.match(/delete-photo\?photo=([^"&]+)&amp;photos=all/);
    expect(revealed).not.toBeNull();
    const olderId = revealed![1]!;
    const confirm = await (
      await fetch(`${origin}${DEMO_BLOCK_PATH}/delete-photo?photo=${olderId}&photos=all`, {
        headers: { cookie },
      })
    ).text();
    // The backlink, the cancel (both the bed link) and the form's own action
    // all keep it, so no way out of this page collapses the reveal.
    expect(confirm).toContain(`${DEMO_BLOCK_PATH}?bed=${PLATE}&amp;photos=all`);
    expect(confirm).toContain(`delete-photo?photo=${olderId}&amp;photos=all`);

    const posted = await fetch(
      `${origin}${DEMO_BLOCK_PATH}/delete-photo?photo=${olderId}&photos=all`,
      { method: 'POST', headers: { cookie, origin }, redirect: 'manual' },
    );
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe(
      `${DEMO_BLOCK_PATH}?bed=${PLATE}&photodeleted=1&photos=all`,
    );

    // And so does SAVE CHANGES: the form's action carries the query string in,
    // so its redirect has to carry the reveal back out.
    const saved = await fetch(`${origin}${DEMO_BLOCK_PATH}?bed=${PLATE}&photos=all`, {
      method: 'POST',
      headers: {
        cookie,
        origin,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ plate: PLATE }).toString(),
      redirect: 'manual',
    });
    expect(saved.status).toBe(303);
    expect(saved.headers.get('location')).toBe(
      `${DEMO_BLOCK_PATH}?bed=${PLATE}&saved=1&photos=all`,
    );
  });
});
