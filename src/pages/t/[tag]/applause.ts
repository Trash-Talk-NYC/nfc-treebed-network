// POST: "SEND APPLAUSE" — the one thing a passer-by can do for a bed that is
// fine. A plain HTML form POST, like every other action here.
//
// Since the captain's 2026-09-12 ask ("i realize when applause is sent i dont
// get emailed") a counted applause can also mail the bed's stewards — at most
// once per bed per NY day, decided and CLAIMED by the rule (`sendApplause`),
// with the send here, outside the transaction, the digest's own shape. The
// send is awaited rather than fired-and-forgotten because on the netlify
// target work after the response is returned may never run; it is bounded
// (mail.ts's 5s timeout, one retry, at most `MAX_BED_SLOTS` recipients in
// parallel), and the common day — no first applause, or no mailable steward —
// adds nothing to the press at all.
import type { APIRoute } from 'astro';
import { buildApplauseMail } from '../../../lib/applause-mail';
import { getStore } from '../../../lib/store';
import { RuleError, sendApplause, type ApplauseNotice } from '../../../lib/service';
import { getExistingActorId } from '../../../lib/session';
import { discardBody } from '../../../lib/request-body';
import { langLink, readLang } from '../../../lib/i18n';
import { mailAvailable, publicOrigin, sendMail } from '../../../lib/mail';
import { ourPlaqueLink } from '../../../lib/plaque-url';
import { requireBoundTagForPost, postOnly } from '../../../lib/tag-route';

/**
 * Mail every recipient the rule named. In parallel, so the visitor's redirect
 * waits on the slowest send rather than their sum; a failure forfeits that
 * day's notice (the claim is already written — service.ts says why) and is
 * logged by user id, never by address.
 */
async function sendApplauseNotice(notice: ApplauseNotice, base: string, origin: string): Promise<void> {
  await Promise.all(
    notice.recipients.map(async (recipient) => {
      const outcome = await sendMail(
        buildApplauseMail({
          user: recipient,
          bed: notice.bed,
          minePath: langLink(`${base}/mine`, recipient.lang),
          origin,
        }),
      );
      if (!outcome.ok) {
        console.error(`[applause] notice send failed for ${recipient.id}: ${outcome.detail}`);
      }
    }),
  );
}

export const POST: APIRoute = async ({ params, request, cookies, redirect, url }) => {
  // Resolved before anything else, and its body accounted for either way: a
  // POST at a tag nobody bound has no bed behind it, and a body left untouched
  // is one Node dumps to its end for us.
  const { bound, refused: unbound } = await requireBoundTagForPost(params.tag, request);
  if (unbound) return unbound;
  const { plate, base } = bound;
  const lang = readLang(url, cookies);
  const refused = await discardBody(request, 'applause');
  if (refused) return refused;
  // A write a cookie-less caller can repeat costs an append-only event apiece
  // and bounds nothing.
  // Minting here would hand a caller that discards cookies a fresh identity
  // every request, and "once a day per person" would bound nothing at all. A
  // neighbour standing at the tree always has one — the door screen they
  // pressed the button on set it — so this costs nobody their applause.
  // `/report` is the deliberate exception (AGENTS.md): filing is the product.
  const actorId = getExistingActorId(cookies);
  if (!actorId) return redirect(langLink(ourPlaqueLink(base), lang), 303);
  try {
    // The claim is only worth making where a mail can actually go out: no
    // transport, or no origin for the links to resolve against, and the day
    // stays unclaimed for a deploy that gets mail later (service.ts).
    const origin = publicOrigin(url.origin);
    const notify = origin !== null && mailAvailable();
    // Whether it counted or was today's second press, the screen is the same:
    // there is nothing here worth showing somebody a rule about.
    const { notice } = await sendApplause(getStore(), { plate, actorId, notify });
    if (notice && origin) await sendApplauseNotice(notice, base, origin);
    return redirect(langLink(`${base}/thanks?applause=1`, lang), 303);
  } catch (err) {
    if (err instanceof RuleError && err.code === 'bed-not-found') {
      // The rule's own message names the plate, which encodes site type and
      // neighbourhood and is never rendered to a visitor. A retired bed makes
      // this a normal state — a stale screen submitting — not a registry typo.
      return new Response('No bed with that plate.', { status: 404 });
    }
    throw err;
  }
};

export const ALL = postOnly;
