// Telling a navigation of our own back to the plaque from a real tap.
//
// The field test's whole metric is the tap count, and it has to be wrong in
// neither direction. Suppressing on "the URL has a query string" under-counts:
// a tag URL arrives decorated with UTM tags and whatever a Popl card or a link
// shortener appends, and none of that makes a visit stop being one. Naming
// only the flags that flash something over-counts: several POST routes send
// someone back to the bare plaque with nothing to say — a report somebody else
// already filed, a second applause the same day — and each of those rendered a
// second tap for one visit.
//
// A link back is the same thing as a redirect back for this purpose, and lands
// on the commonest flow of all: tap the tag, send, read the thank-you, press
// "back to the bed" — one person at one tree bed, and two taps.
//
// So every navigation of ours to the plaque carries a flag from this list, and
// only these flags suppress the event.
//
// The list is one flag, and stays one: the Option A confirm, escalate and
// rate-limited screens carried readable words of their own (`confirmed`,
// `raised`, `limited`), and those went with the routes. Words like that are the
// collision surface this file argues against — anybody's link decoration can
// set them, and each one that arrives on a real tap is a visit not counted.

/** Query flags that mark a plaque render as the tail of one of our own POSTs. */
export const POST_ACTION_FLAGS = ['tg_action'] as const;

/**
 * The plaque URL for every navigation that is ours rather than a tap: where a
 * POST route sends someone when it has nothing to flash (a rule said no, or the
 * work was done somewhere the plaque doesn't announce), and where one of our
 * own screens links back — the thank-you and adopted takeovers, the too-large
 * screen, the sign-in and adopt forms, the steward's own view.
 *
 * One function for both because it answers one question, and answering it two
 * ways is how half of it would drift: somebody already on one of our screens is
 * somebody whose tap was counted when they arrived.
 *
 * The flag is deliberately prefixed rather than a readable word like `done`: it
 * decides whether a visit is counted, so it must be one no third party's link
 * decoration can collide with, in either direction.
 */
export function ourPlaqueLink(base: string): string {
  return `${base}?tg_action=1`;
}

/** Whether this plaque render is a navigation of ours rather than a tap. */
export function isPostAction(url: URL): boolean {
  return POST_ACTION_FLAGS.some((flag) => url.searchParams.has(flag));
}
