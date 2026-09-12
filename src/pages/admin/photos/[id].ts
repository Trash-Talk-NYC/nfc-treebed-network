// GET: one stored care photo's bytes, for the block admin page's own <img>
// tags — and for nothing else. Photos are admin-only (the captain accepted
// holding pictures the public uploads; the public never sees them back), so
// this sits behind the same gate as every /admin route and serves nothing
// before it answers.
//
// What is served is decided by the METADATA row, never by the URL alone: the
// id has to name a `ReportPhoto` the dataset holds, so a deleted photo is a
// 404 even if its blob briefly outlives the row, and the content type is the
// stored, allowlisted one (`storedPhotoContentType` at the write; narrowed
// again here so a row written by anything else can still never serve
// scriptable markup). `nosniff` and a no-source CSP close the rest: the one
// thing an uploaded file may do on this origin is render as pixels.
import type { APIRoute } from 'astro';

import { requireAdmin } from '../../../lib/admin-route';
import { langLink, readLang } from '../../../lib/i18n';
import { storedPhotoContentType } from '../../../lib/service';
import { getPhotoBlobs, getStore } from '../../../lib/store';

export const GET: APIRoute = async ({ params, request, cookies, url }) => {
  const gate = await requireAdmin(request, cookies, langLink('/admin', readLang(url, cookies)));
  if (gate.refused) return gate.refused;

  const meta = await getStore().getReportPhoto(params.id ?? '');
  if (!meta) return new Response('Not found.', { status: 404 });
  const bytes = await getPhotoBlobs().getPhotoBlob(meta.id);
  if (bytes === null) {
    // A row whose blob is gone — the crash window a delete can leave. Logged
    // as ours to look at; the admin sees a broken image, not a 500.
    console.error(`[admin-photos] photo ${meta.id} has a row but no blob`);
    return new Response('Not found.', { status: 404 });
  }
  // Handed over as a bare ArrayBuffer: BodyInit takes neither a view nor a
  // buffer that could be shared, so the one copy is made explicitly.
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new Response(body, {
    headers: {
      'content-type': storedPhotoContentType(meta.contentType),
      'content-length': String(bytes.byteLength),
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
      // Admin-only content on a 30-day-cookie surface: never cached shared,
      // and not worth caching private — a photo is read once and acted on.
      'cache-control': 'private, no-store',
    },
  });
};

// 405 for anything else, rather than Astro's own 404 with a log line per
// request (tag-route.ts) — the body, if any, is drained by src/middleware.ts.
export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { allow: 'GET' } });
