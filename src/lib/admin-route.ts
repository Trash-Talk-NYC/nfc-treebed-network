// What every /admin route does before it does anything else.
//
// The admin surface is where contact details live, so nothing under /admin
// renders, reads a form, or touches the store until the session check has
// answered (src/lib/session.ts, the admin session). One place, like
// tag-route.ts, so the routes cannot drift on the two states that matter:
//
//   admin disabled   `TREEBED_ADMIN_KEY` unset in production — the surface
//                    does not exist. 404 in plain text, the same answer a
//                    route that was never built would give; advertising a
//                    sign-in for a door with no key helps only a prober.
//   no session       the surface exists and this caller has not opened it —
//                    off to the key screen, which is the one place that
//                    renders it.
//
// Both answers happen before any body is read, so the body is `abandonBody`'d
// on the way out for the same reason tag-route.ts does it: a refused request
// whose body nobody touches is one Node reads to its end for us.

import type { AstroCookies } from 'astro';

import { abandonBody } from './request-body';
import { adminEnabled, isAdminSession } from './session';

export type AdminGate = { ok: true; refused: null } | { ok: false; refused: Response };

/**
 * Admit an admin session, or answer for the request. `signInPath` is where a
 * session-less caller is sent — the key screen, with the language already on
 * it (the caller builds it with `langLink`).
 */
export async function requireAdmin(
  request: Request,
  cookies: AstroCookies,
  signInPath: string,
): Promise<AdminGate> {
  if (!adminEnabled()) {
    await abandonBody(request);
    return { ok: false, refused: new Response('Not found.', { status: 404 }) };
  }
  if (!isAdminSession(cookies)) {
    await abandonBody(request);
    // 303 for anything that arrived with a body, as tag-route.ts answers: a
    // 302 invites a client reading RFC 9110 to repeat the POST at the key
    // screen.
    const seeOther = request.method !== 'GET' && request.method !== 'HEAD';
    return {
      ok: false,
      refused: new Response(null, {
        status: seeOther ? 303 : 302,
        headers: { location: signInPath },
      }),
    };
  }
  return { ok: true, refused: null };
}

/** A plain 404 for an admin route whose subject does not exist, body accounted for. */
export async function refuseAdminWithBody(request: Request, response: Response): Promise<Response> {
  await abandonBody(request);
  return response;
}

/**
 * Send an admin caller somewhere else because the bed under this page has
 * changed state since it was opened — a stale tab, or a resubmitted
 * confirmation. The body is accounted for first (nothing here reads it), and
 * the status branches the way tag-route.ts branches: 302 for a GET or HEAD,
 * 303 for anything that arrived with a body, so a client reading RFC 9110
 * does not repeat the POST at the page it lands on.
 *
 * `to` takes two destinations where the honest answer differs by method: a
 * resubmitted confirmation has something to flash, a stale GET has not.
 */
export async function redirectAdminWithBody(
  request: Request,
  to: string | { get: string; post: string },
): Promise<Response> {
  await abandonBody(request);
  const seeOther = request.method !== 'GET' && request.method !== 'HEAD';
  const location = typeof to === 'string' ? to : seeOther ? to.post : to.get;
  return new Response(null, { status: seeOther ? 303 : 302, headers: { location } });
}
