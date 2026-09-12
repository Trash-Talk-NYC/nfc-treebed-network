// The sign-in mail: the one message that carries a live token.
//
// Built here, beside nothing else, so the token's whole journey is legible:
// minted in service.ts, threaded through this builder into the link, handed
// to the mail plane (mail.ts), and never stored, logged, or echoed into any
// response. The language is the one the auth screen spoke when the link was
// requested — the person's own choice, made seconds earlier — rather than
// the stored profile language, which the digest uses.

import { SIGNIN_MAIL } from './copy';
import type { Lang } from './i18n';
import { defaultPresentation } from './presentation';
import type { MailMessage } from './mail';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * One steward's sign-in mail. `link` is the absolute signin URL with the
 * token already on it; the builder treats it as opaque.
 */
export function buildSignInMail(args: { email: string; lang: Lang; link: string }): MailMessage {
  const { lang, link } = args;
  const colors = defaultPresentation().colors;
  const body = SIGNIN_MAIL.body[lang];
  const button = SIGNIN_MAIL.button[lang];
  const html =
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.5;color:${colors.ink};background:${colors.ground};padding:20px;">` +
    `<p style="margin:0 0 16px;">${escapeHtml(body)}</p>` +
    `<p style="margin:0;"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:${colors.action};color:${colors.onAction};font-weight:700;text-decoration:none;border-radius:8px;">${escapeHtml(button)}</a></p>` +
    `</div>`;
  return {
    to: { email: args.email },
    subject: SIGNIN_MAIL.subject[lang],
    html,
    text: `${body}\n\n${link}\n`,
  };
}
