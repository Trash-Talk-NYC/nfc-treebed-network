// The mail plane: how anything in this app sends an email.
//
// One transport decision, made here and nowhere else, mirroring the sister
// property's Brevo client (trashtalknyc-website, src/lib/server/brevo.ts):
// raw fetch against Brevo's transactional endpoint — the SDK would be a
// dependency for one endpoint — with a timeout on every call and one bounded
// retry on 429/5xx, because Brevo allows 10 req/s on non-enterprise plans and
// a hung connection must not eat a function's whole budget.
//
// Three environments, three answers:
//  - `BREVO_API_KEY` set → real sends, from `TREEBED_MAIL_FROM`.
//  - no key, outside production → the dev outbox: each message is written as
//    one JSON file under `.data/outbox/`, which is how local runs and the
//    e2e suite read the sign-in link out of a mail nobody can receive.
//  - no key, in production → mail is UNAVAILABLE (`mailAvailable()` false).
//    The sign-in screen says email sign-in isn't ready yet; adoption and the
//    whole tap flow carry on. Production must never fall back to a disk
//    outbox: on the deployed site that is a write to a filesystem that
//    forgets, holding mail nobody would ever see.
//
// "Production" is decided WITHOUT import.meta: this module is imported by the
// scheduled digest function, which Netlify bundles outside the Vite build, so
// a Vite-replaced `import.meta.env.PROD` (the session module's test) would be
// undefined there and throw. `TREEBED_STORE=blobs` is the runtime signal the
// deployed site actually carries — the publicly tappable store IS production
// — with NODE_ENV as the conventional belt beside it.
//
// The token in a sign-in link passes through here on its way into a message
// body. It is never logged: failures log the Brevo error code and the
// recipient's absence or presence of nothing — no subject, no body, no URL.

import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const BREVO_EMAIL_URL = 'https://api.brevo.com/v3/smtp/email';

// A send happens on a request (sign-in) or inside a scheduled function's
// budget (digest); either way one hung connection must not stall the caller
// for long, and two attempts plus the wait must still fit comfortably.
const SEND_TIMEOUT_MS = 5000;
const RETRY_DELAY_CAP_MS = 2000;
const RETRY_FALLBACK_DELAY_MS = 1000;

export interface MailAddress {
  email: string;
  name?: string;
}

export interface MailMessage {
  to: MailAddress;
  subject: string;
  html: string;
  /** Plain-text alternative; always sent so no client renders raw HTML. */
  text: string;
  /**
   * Extra SMTP headers, passed through Brevo's own `headers` field — the
   * digest's `List-Unsubscribe` / `List-Unsubscribe-Post` pair. The outbox
   * transport records them too, so a test can hold the mail to them.
   */
  headers?: Record<string, string>;
}

export type MailResult =
  | { ok: true; transport: 'brevo' | 'outbox' }
  | { ok: false; detail: string };

/**
 * Whether this process is serving the real network — exported because the
 * unsubscribe-link module needs the same answer for its secret resolution,
 * and both run in bundles (the scheduled function's) where session.ts's
 * Vite-replaced `import.meta.env.PROD` does not exist.
 */
export function isProductionLike(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.TREEBED_STORE === 'blobs';
}

/**
 * Whether this deploy can send email at all. False only in production with
 * no `BREVO_API_KEY`: outside production the outbox stands in, so the flows
 * behind mail stay drivable with nothing configured.
 */
export function mailAvailable(): boolean {
  if (process.env.BREVO_API_KEY) return senderAddress() !== null;
  return !isProductionLike();
}

/**
 * The From header, out of `TREEBED_MAIL_FROM`: either a bare address or
 * `Display Name <address>`. Null when unset or unparseable — a real send
 * refuses loudly rather than inventing a sender Brevo would bounce; the
 * outbox uses a placeholder since nothing delivers it.
 */
export function senderAddress(): MailAddress | null {
  const raw = (process.env.TREEBED_MAIL_FROM ?? '').trim();
  if (raw === '') return null;
  const withName = /^(.*)<([^<>\s]+@[^<>\s]+)>$/.exec(raw);
  if (withName) {
    const name = withName[1]!.trim().replace(/^"|"$/g, '');
    return name === '' ? { email: withName[2]! } : { email: withName[2]!, name };
  }
  return /^[^\s@]+@[^\s@]+$/.test(raw) ? { email: raw } : null;
}

/**
 * The absolute origin links in an email resolve against.
 *
 * `TREEBED_PUBLIC_ORIGIN` is authoritative and required in production: a
 * sign-in link built from the request's own Host header would let anyone who
 * can reach the server mint a link for somebody else's email that points at
 * a host of the caller's choosing — a phishing page that harvests the very
 * token the link carries. Outside production the request's origin is a safe
 * convenience (the dev server and the e2e suite sit on ephemeral ports).
 * Null means links cannot be built, which callers treat as mail being
 * unavailable rather than guessing a hostname.
 */
export function publicOrigin(requestOrigin?: string): string | null {
  const configured = (process.env.TREEBED_PUBLIC_ORIGIN ?? '').trim().replace(/\/+$/, '');
  if (configured !== '') return configured;
  if (!isProductionLike() && requestOrigin) return requestOrigin.replace(/\/+$/, '');
  return null;
}

/** Where the dev outbox lives — beside the local store, e2e-relocatable. */
export function outboxDir(): string {
  return path.join(process.env.TREEBED_DATA_DIR ?? path.resolve('.data'), 'outbox');
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelayMs(res: Response): number {
  const raw = res.headers.get('retry-after');
  const seconds = raw === null ? NaN : Number(raw);
  // An HTTP-date Retry-After parses as NaN and falls through to the jittered
  // fallback rather than being honoured — acceptable for one retry.
  const base =
    Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000
      : RETRY_FALLBACK_DELAY_MS + Math.random() * 250;
  return Math.min(base, RETRY_DELAY_CAP_MS);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Brevo's error `code` (e.g. "invalid_parameter"), never the full body — the
 * body echoes the message back, and a sign-in mail's body holds the token.
 */
async function errorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { code?: string };
    if (body.code) return body.code;
  } catch {
    // Non-JSON error body — the status alone will have to do.
  }
  return 'unknown';
}

async function sendViaBrevo(apiKey: string, message: MailMessage): Promise<MailResult> {
  const sender = senderAddress();
  if (sender === null) {
    // A key with no sender is half a configuration; refusing is what makes
    // the missing variable findable instead of a Brevo bounce.
    return { ok: false, detail: 'TREEBED_MAIL_FROM is not set or unparseable' };
  }
  const attempt = () =>
    fetch(BREVO_EMAIL_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender,
        to: [message.to],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
        ...(message.headers ? { headers: message.headers } : {}),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

  let res: Response;
  try {
    res = await attempt();
    if (isRetryable(res.status)) {
      await sleep(retryDelayMs(res));
      res = await attempt();
    }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'network error' };
  }
  if (res.ok) return { ok: true, transport: 'brevo' };
  return { ok: false, detail: `brevo ${res.status} ${await errorCode(res)}` };
}

function sendToOutbox(message: MailMessage): MailResult {
  try {
    const dir = outboxDir();
    mkdirSync(dir, { recursive: true });
    const file = path.join(
      dir,
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`,
    );
    writeFileSync(
      file,
      JSON.stringify(
        {
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.headers ? { headers: message.headers } : {}),
        },
        null,
        2,
      ),
      'utf8',
    );
    return { ok: true, transport: 'outbox' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'outbox write failed' };
  }
}

/**
 * Send one message through whichever transport this environment has. Never
 * throws — a failed mail is reported, not fatal, because nothing that sends
 * one (the sign-in screen, the digest) should 500 over a provider hiccup —
 * and never logs the message it was carrying.
 */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (apiKey) return sendViaBrevo(apiKey, message);
  if (!isProductionLike()) return sendToOutbox(message);
  return { ok: false, detail: 'mail is not configured (BREVO_API_KEY unset in production)' };
}
