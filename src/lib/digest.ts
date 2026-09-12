// The steward digest: one periodic email per active steward with an email.
//
// The captain asked for "an intermediary email that is able to send users
// messages on x frequency, i havent decided yet" — so the frequency is a
// stored network setting with a default (`NetworkSettings.digestCadence`,
// default weekly), edited on the admin index, and everything here reads it
// rather than assuming one.
//
// Runs from the scheduled Netlify function (netlify/functions/digest.mts),
// daily; each run sends only to stewards whose cadence has elapsed, so the
// daily schedule and the chosen cadence stay independent. This module is
// deliberately import-safe outside the Vite build — no import.meta, no
// adapter types — because the scheduled function is bundled by Netlify's own
// esbuild, not by Astro.
//
// Idempotence is claim-then-send: a steward's `digestLastSentAt` is advanced
// inside a transaction BEFORE their mail goes out, so a crash or a second
// concurrent run costs one period's digest at worst and never sends it
// twice. The send itself happens OUTSIDE the transaction — a Blobs
// transaction re-runs its callback when a commit loses, and a mail call
// inside one would be a double send waiting for a busy afternoon.
//
// Nobody is emailed without an address, and design-record.md's answered open
// question 3 still holds: a missing email is never consent to be contacted.
// A pen-and-paper steward the captain wrote in WITH an email gave it for
// exactly this, and is included.

import type { Store } from './store';
import type { Bed, DigestCadence, Report, User } from './types';
import type { Lang } from './i18n';
import { langLink } from './i18n';
import { DIGEST_MAIL } from './copy';
import { activeBinding, TAG_BINDINGS, type TagBinding } from './tag-bindings';
import { defaultPresentation } from './presentation';
import { problemFor } from './problem';
import { sendMail, type MailMessage, type MailResult } from './mail';
import { unsubscribePath } from './unsubscribe-link';

export { unsubscribePath, verifyUnsubscribe } from './unsubscribe-link';

/** How long each cadence waits between sends. `off` sends never. */
export function cadencePeriodMs(cadence: DigestCadence): number | null {
  const day = 24 * 60 * 60 * 1000;
  switch (cadence) {
    case 'off':
      return null;
    case 'weekly':
      return 7 * day;
    case 'biweekly':
      return 14 * day;
    case 'monthly':
      return 30 * day;
  }
}

/**
 * The runner fires daily but never exactly on the hour it last did, so a
 * strict `>= period` comparison would push every send a day later each
 * period. An hour of slack keeps "weekly" meaning the same weekday.
 */
const DUE_SLACK_MS = 60 * 60 * 1000;

/**
 * Whether this steward's digest is due — the selection rule, pure so the
 * suite can drive it directly. Beds are the caller's to check (a steward
 * with no active adoption gets nothing to digest).
 */
export function digestDue(user: User, cadence: DigestCadence, now: Date): boolean {
  const period = cadencePeriodMs(cadence);
  if (period === null) return false;
  if (user.email.trim() === '' || user.digestOptedOut) return false;
  if (user.digestLastSentAt === null) return true;
  return now.getTime() - new Date(user.digestLastSentAt).getTime() >= period - DUE_SLACK_MS;
}

// ── Building one steward's digest ──────────────────────────────────────

/** Everything one bed contributes to the mail. */
export interface DigestBed {
  bed: Bed;
  openReport: Report | null;
  /** Applause since the last digest (or one period back, on the first). */
  applause: number;
  /** The steward's own view, when a tag is bound to the bed; else null. */
  minePath: string | null;
}

export interface DigestContent {
  user: User;
  beds: DigestBed[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The steward's-view path for a bed, through the tag registry: beds are
 * reached by tag, and a bed whose guard (and tag) is not in yet simply has
 * no URL to offer. Reads the checked-in registry the routes read.
 */
function mineLink(plate: string, lang: Lang, bindings: readonly TagBinding[]): string | null {
  const bound = bindings.find((b) => b.sitePlate === plate && b.retiredAt === null);
  const active = bound ? activeBinding(bindings, bound.tagId) : null;
  return active ? langLink(`/t/${active.tagId}/mine`, lang) : null;
}

/** Gather what one steward's digest says, reading through `tx`. */
async function gatherContent(
  tx: Store,
  user: User,
  periodMs: number,
  now: Date,
  bindings: readonly TagBinding[],
): Promise<DigestContent | null> {
  const adoptions = await tx.getActiveAdoptionsForUser(user.id);
  if (adoptions.length === 0) return null;
  const since = user.digestLastSentAt ?? new Date(now.getTime() - periodMs).toISOString();
  const beds: DigestBed[] = [];
  for (const adoption of adoptions) {
    const bed = await tx.getBed(adoption.bedPlate);
    if (!bed) continue;
    const applause = (await tx.getEvents(bed.plate, 'applause')).filter(
      (e) => e.createdAt >= since,
    ).length;
    beds.push({
      bed,
      openReport: await tx.getOpenReport(bed.plate),
      applause,
      minePath: mineLink(bed.plate, user.lang, bindings),
    });
  }
  return beds.length === 0 ? null : { user, beds };
}

/**
 * The mail itself, in the steward's own language — the digest is the one
 * surface that reaches somebody away from the screen's toggle, so the
 * stored `User.lang` decides, not a cookie. Both an HTML and a text body,
 * built from the same strings; every stored value that reaches the HTML is
 * escaped (the bed name is visitor free text).
 */
export function buildDigestMail(content: DigestContent, origin: string): MailMessage {
  const { user, beds } = content;
  const lang = user.lang;
  const colors = defaultPresentation().colors;
  const t = (phrase: { en: string; es: string }) => phrase[lang];

  const textLines: string[] = [`${t(DIGEST_MAIL.greeting)} ${user.firstName},`, ''];
  const htmlBeds: string[] = [];
  for (const { bed, openReport, applause, minePath } of beds) {
    const bedTitle = [bed.bedName, bed.treeType[lang], bed.plantingSpaceId ? `#${bed.plantingSpaceId}` : null]
      .filter((part): part is string => part !== null && part !== '')
      .join(' · ');
    const lines: string[] = [];
    if (openReport) {
      const problems = openReport.categories.map((c) => problemFor(c).label[lang]).join(', ');
      lines.push(`${t(DIGEST_MAIL.openReport)}: ${problems}`);
    } else {
      lines.push(t(DIGEST_MAIL.noOpenReport));
    }
    lines.push(`${t(DIGEST_MAIL.applause)}: ${applause}`);
    textLines.push(bedTitle, ...lines.map((line) => `  ${line}`));
    if (minePath) textLines.push(`  ${t(DIGEST_MAIL.viewBed)}: ${origin}${minePath}`);
    textLines.push('');
    htmlBeds.push(
      `<div style="margin:0 0 16px;padding:12px 16px;background:${colors.surface};border-radius:8px;">` +
        `<p style="margin:0 0 6px;font-weight:700;">${escapeHtml(bedTitle)}</p>` +
        lines.map((line) => `<p style="margin:0 0 4px;">${escapeHtml(line)}</p>`).join('') +
        (minePath
          ? `<p style="margin:6px 0 0;"><a href="${escapeHtml(`${origin}${minePath}`)}" style="color:${colors.action};font-weight:700;">${escapeHtml(t(DIGEST_MAIL.viewBed))}</a></p>`
          : '') +
        `</div>`,
    );
  }

  const unsubscribe = `${origin}${unsubscribePath(user)}`;
  textLines.push(t(DIGEST_MAIL.careReminder), '', `${t(DIGEST_MAIL.unsubscribe)}: ${unsubscribe}`);

  const html =
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.5;color:${colors.ink};background:${colors.ground};padding:20px;">` +
    `<p style="margin:0 0 12px;">${escapeHtml(`${t(DIGEST_MAIL.greeting)} ${user.firstName},`)}</p>` +
    htmlBeds.join('') +
    `<p style="margin:0 0 16px;">${escapeHtml(t(DIGEST_MAIL.careReminder))}</p>` +
    `<p style="margin:0;font-size:13px;"><a href="${escapeHtml(unsubscribe)}" style="color:${colors.muted};">${escapeHtml(t(DIGEST_MAIL.unsubscribe))}</a></p>` +
    `</div>`;

  return {
    to: { email: user.email, name: `${user.firstName} ${user.lastName}`.trim() },
    subject: t(DIGEST_MAIL.subject),
    html,
    text: textLines.join('\n'),
  };
}

// ── The run ─────────────────────────────────────────────────────────────

export interface DigestRunResult {
  cadence: DigestCadence;
  /** Stewards whose digest was claimed and sent this run. */
  sent: number;
  /** Claims whose send then failed — that period's digest is forfeited. */
  failed: number;
}

/**
 * One scheduled run. `send` is injectable so the suite can watch what would
 * go out without a transport; the scheduled function passes nothing and gets
 * the real mail plane.
 */
export async function runDigest(
  store: Store,
  args: {
    origin: string;
    now?: Date;
    send?: (message: MailMessage) => Promise<MailResult>;
    bindings?: readonly TagBinding[];
  },
): Promise<DigestRunResult> {
  const now = args.now ?? new Date();
  const send = args.send ?? sendMail;
  const bindings = args.bindings ?? TAG_BINDINGS;
  const { digestCadence } = await store.getNetworkSettings();
  const period = cadencePeriodMs(digestCadence);
  const result: DigestRunResult = { cadence: digestCadence, sent: 0, failed: 0 };
  if (period === null) return result;

  // The candidate list is a plain read; the claim below re-decides each one
  // inside its own transaction, so a stale candidate costs a no-op, never a
  // duplicate mail.
  const candidates = (await store.getUsers()).filter((user) => digestDue(user, digestCadence, now));
  for (const candidate of candidates) {
    const content = await store.transaction(async (tx) => {
      const user = await tx.getUser(candidate.id);
      if (!user || !digestDue(user, digestCadence, now)) return null;
      const gathered = await gatherContent(tx, user, period, now, bindings);
      if (gathered === null) return null;
      // The claim: advanced before anything is sent, so a crash between the
      // commit and the send loses one digest instead of doubling it.
      await tx.updateUser({ ...user, digestLastSentAt: now.toISOString() });
      return gathered;
    });
    if (content === null) continue;
    const outcome = await send(buildDigestMail(content, args.origin));
    if (outcome.ok) {
      result.sent += 1;
    } else {
      result.failed += 1;
      // The address is already on the user record; repeating it in a
      // scheduled function's log would copy PII somewhere nothing prunes.
      console.error(`[digest] send failed for ${content.user.id}: ${outcome.detail}`);
    }
  }
  return result;
}
