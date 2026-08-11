// Telling one of our own redirects back to the plaque from a real tap.
//
// The field test's whole metric is the tap count, and it has to be wrong in
// neither direction. Suppressing on "the URL has a query string" under-counts:
// a tag URL arrives decorated with UTM tags and whatever a Popl card or a link
// shortener appends, and none of that makes a visit stop being one. Naming
// only the flags that flash something over-counts: several POST routes send
// someone back to the bare plaque with nothing to say — a report somebody else
// already filed, a confirm on a report that has since been closed — and each
// of those rendered a second tap for one visit.
//
// So every redirect of ours carries a flag from this list, and only these
// flags suppress the event.

/** Query flags that mark a plaque render as the tail of one of our own POSTs. */
export const POST_ACTION_FLAGS = ['confirmed', 'raised', 'limited', 'tg_action'] as const;

/**
 * Where a POST route sends someone when it has nothing to flash — a rule said
 * no, or the work was done somewhere the plaque doesn't announce.
 *
 * Deliberately prefixed rather than a readable word like `done`: this flag
 * decides whether a visit is counted, so it must be one no third party's link
 * decoration can collide with, in either direction.
 */
export function plaqueAfterAction(base: string): string {
  return `${base}?tg_action=1`;
}

/** Whether this plaque render is a redirect of ours rather than a tap. */
export function isPostAction(url: URL): boolean {
  return POST_ACTION_FLAGS.some((flag) => url.searchParams.has(flag));
}
