// The applause notification: the mail a bed's stewards get the first time a
// neighbour applauds it each NY day ("i realize when applause is sent i dont
// get emailed" — the captain, 2026-09-12).
//
// Its own module beside signin-mail.ts, for the same reason: one mail, one
// builder, assembled by hand and therefore escaping every stored value it
// interpolates (the bed's given name is visitor free text). Who gets it and
// how often is the RULE's business (`sendApplause` in service.ts — one mail
// per bed per day, digest opt-out honoured, nobody without an email); this
// module only says the words, in the steward's stored language, the way the
// digest does.
//
// It reuses the digest's greeting, "see your bed" and unsubscribe phrases so
// the two mails a steward receives cannot drift apart on them, and it carries
// the same RFC 8058 unsubscribe headers over the same signed link — one
// opt-out flag covers every courtesy mail, and the mail says so.

import { APPLAUSE_MAIL, DIGEST_MAIL } from './copy';
import { capitalizeFirst, escapeHtml, speciesShown } from './format';
import type { MailMessage } from './mail';
import { defaultPresentation } from './presentation';
import type { Bed, User } from './types';
import { unsubscribePath } from './unsubscribe-link';

/**
 * One steward's applause mail. `minePath` is the steward-view path for the
 * bed in the steward's own language (the caller knows the tag; this builder
 * does not) — null for a bed no tag is bound to, where there is no steward
 * view to offer and the mail omits the link, exactly as the digest does.
 * `origin` is the absolute origin every link resolves against
 * (`publicOrigin` — never the Host header in production).
 */
export function buildApplauseMail(args: {
  user: User;
  bed: Bed;
  minePath: string | null;
  origin: string;
}): MailMessage {
  const { user, bed, origin } = args;
  const lang = user.lang;
  const colors = defaultPresentation().colors;
  const t = (phrase: { en: string; es: string }) => phrase[lang];

  // The same title line the digest builds: the given name if the bed has one,
  // the species capitalized for standalone printing, the public NYC number.
  const bedTitle = [
    bed.bedName,
    capitalizeFirst(speciesShown(bed.treeType)[lang]),
    bed.plantingSpaceId ? `#${bed.plantingSpaceId}` : null,
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');

  const mineLink = args.minePath === null ? null : `${origin}${args.minePath}`;
  const unsubscribe = `${origin}${unsubscribePath(user)}`;

  const text = [
    `${t(DIGEST_MAIL.greeting)} ${user.firstName},`,
    '',
    bedTitle,
    t(APPLAUSE_MAIL.body),
    '',
    ...(mineLink === null ? [] : [`${t(DIGEST_MAIL.viewBed)}: ${mineLink}`, '']),
    t(APPLAUSE_MAIL.oncePerDay),
    '',
    `${t(DIGEST_MAIL.unsubscribe)}: ${unsubscribe}`,
  ].join('\n');

  const html =
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.5;color:${colors.ink};background:${colors.ground};padding:20px;">` +
    `<p style="margin:0 0 12px;">${escapeHtml(`${t(DIGEST_MAIL.greeting)} ${user.firstName},`)}</p>` +
    `<div style="margin:0 0 16px;padding:12px 16px;background:${colors.surface};border-radius:8px;">` +
    `<p style="margin:0 0 6px;font-weight:700;">${escapeHtml(bedTitle)}</p>` +
    `<p style="margin:0 0 4px;">${escapeHtml(t(APPLAUSE_MAIL.body))}</p>` +
    (mineLink === null
      ? ''
      : `<p style="margin:6px 0 0;"><a href="${escapeHtml(mineLink)}" style="color:${colors.action};font-weight:700;">${escapeHtml(t(DIGEST_MAIL.viewBed))}</a></p>`) +
    `</div>` +
    `<p style="margin:0 0 16px;">${escapeHtml(t(APPLAUSE_MAIL.oncePerDay))}</p>` +
    `<p style="margin:0;font-size:13px;"><a href="${escapeHtml(unsubscribe)}" style="color:${colors.muted};">${escapeHtml(t(DIGEST_MAIL.unsubscribe))}</a></p>` +
    `</div>`;

  return {
    to: { email: user.email, name: `${user.firstName} ${user.lastName}`.trim() },
    subject: t(APPLAUSE_MAIL.subject),
    html,
    text,
    // RFC 8058, exactly as the digest carries it: the same signed link flips
    // the same flag, so a steward's "stop these emails" stops both mails.
    headers: {
      'List-Unsubscribe': `<${unsubscribe}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
