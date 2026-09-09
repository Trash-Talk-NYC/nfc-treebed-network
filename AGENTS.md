# NFC Tree Bed Network — agent notes

The v1 tap screen ("plaque") for Trash Talk NYC's NFC tree bed network.
A pedestrian taps a tag on a tree guard and lands on `/b/<plate>` — e.g. `/b/BED-HRL-0847`.

Source-of-truth documents live in the firstmate repo under `data/plaque-mvp-n4/`:
the approved UI prototype (`prototype/Tree Guard Plaque v2.dc.html`) is authoritative for visuals/copy/flow, and `spec.md` for product intent and rules.

## Stack

- Astro (server-rendered) + TypeScript strict, with two build targets selected in `astro.config.mjs` by `TREEBED_ADAPTER`:
  `node` (the default — `@astrojs/node` standalone server, what `npm start`, `npm run preview` and the e2e suite run) and `netlify` (`@astrojs/netlify`, what production deploys; `netlify.toml` sets the variable for every Netlify build).
  The node target stays first-class rather than becoming a dev shim because the request-body bounds below are measured against its real sockets.
- **Both adapters are pinned to exact versions**, and for the same reason: an adapter consumes astro's app API through a permissive peer range, so a version that satisfies the range can still break the built server at boot.
  `@astrojs/node` is pinned to 11.1.1 because 11.1.4 calls `app.getLogger()`, which `astro` 7.2.1 does not have — measured, not hypothetical.
  `@astrojs/netlify` is pinned to 8.2.3 against the same trap on the adapter production actually deploys with, where the break would first appear live.
  Unpin both when astro itself is upgraded.
- Requires Node >= 22 (`~/.nvm/versions/node/v22.23.1` works; the default shell Node 18.10 does not).
- `npm run dev` / `npm run build` / `npm run preview` / `npm test` (vitest) / `npm run test:e2e` / `npm run check` (astro check).
  `npm test` is the fast suite — rules and transport handling, no build — and `npm run test:e2e` builds the app, serves `dist/server/entry.mjs`, and posts real bodies at it (`vitest.e2e.config.ts`); CI runs both (`.github/workflows/tests.yml`).
  `npm run preview` and `npm start` both serve the production build, so both need `TREEBED_SESSION_SECRET` and both are gated by `scripts/preflight.mjs`.
  CI also runs `TREEBED_ADAPTER=netlify npm run build` after both suites, because every other step builds and exercises the node target only — the adapter production ships would otherwise be built for the first time by a manual deploy.
- The plaque ships zero client JavaScript except one inline script enhancing the severity sheet — live tier name/definition on the slider, and the "photo attached" state on the file input.
  Every form is a plain HTML POST and works with JavaScript disabled — keep it that way; the spec calls it the single most important resilience decision in the build.

## Architecture invariants

- **All persistence goes through the `Store` interface in `src/lib/store.ts`.**
  Two implementations exist, selected at runtime by `getStore()` in `store.ts` — beside the contract, not inside either backend — on `TREEBED_STORE`: `LocalStore` (`src/lib/store-local.ts`, one JSON file in `.data/`, gitignored — dev and tests, the default) and `BlobsStore` (`src/lib/store-blobs.ts`, Netlify Blobs — the deployed pilot, `TREEBED_STORE=blobs`).
  The dataset shape, the seed, and the operations they share live in `src/lib/store-dataset.ts`, so the backends cannot drift on what the data means.
  Swapping to Supabase later still means writing one new `Store` implementation and changing `getStore()` — nothing else.
  `TREEBED_STORE` is asserted rather than defaulted-through: an unrecognized value is refused instead of being read as `local`, and on the netlify target the disk store is refused outright (a function instance has no disk that outlives the request, so it would 500 on EROFS or, worse, keep a per-instance dataset that forgets between invocations).
  Which target a bundle was built for is `BUILD_TARGET` in `src/lib/build-target.ts`, defined by `astro.config.mjs` beside the adapter it picks — the deploy-critical facts are then held by the build rather than by a platform variable that could be renamed.
  `scripts/preflight.mjs` never runs for a function, so this assertion is what a misconfigured deploy hits, on its first request.
- **`BlobsStore` commits by atomically creating revision keys (`rev/<n>`), never by overwriting one.**
  Function instances scale horizontally, so its `transaction` is optimistic: read the newest revision, run the callback on a private copy, commit by creating `rev/<n+1>` with `onlyIfNew`, and re-run the whole callback on loss — a rule check made against a dataset another commit replaced never reaches the store.
  ETag compare-and-swap (`onlyIfMatch`) was rejected because the emulated Blobs server (`@netlify/blobs/server`, which `tests/store-blobs.test.ts` runs the real wire protocol against) does not produce ETags on reads, so that path would be untestable.
  Old revisions are pruned a safe distance behind the newest; the survivors double as a short paper trail (`netlify blobs:list treebed`).
A commit's own expired revision is deleted by key, since arithmetic already knows which one fell out of the window; the full listing sweep runs on a failed delete and once every `KEPT_REVISIONS` commits, because an instance recycled between a commit and its prune leaves an orphan no later commit's arithmetic names.
- **Which revision is newest is never decided by a key listing.**
  Blobs' strong consistency covers `get`, not `list`, so a stale listing would hand a reader an older revision — the receipt a POST just redirected to would 404 — and would make `transaction` burn every attempt against a revision number somebody else already owns.
  A read instead takes the `head` pointer (a strongly consistent `get`, moved after each commit) as a *lower bound* and walks forward one `get` at a time until a revision is missing: the pointer may lag or be moved back a revision by a racing commit, the walk cannot, because a revision that exists is one `get` must return.
  The listing survives only as the fallback for a pointer that is missing or names a pruned revision, where being approximately right is enough to start the walk from.
  `tests/store-blobs.test.ts` drives both a lagging pointer and no pointer at all.
- **A request validates the dataset once, not once per read.**
  `src/middleware.ts` runs every route inside a `runInRequestContext` (`src/lib/request-context.ts`), and `BlobsStore` memoizes its validated read there.
  One plaque render was six or more sequential Blobs round trips awaited before first paint, on cellular, for someone standing at the tree; it is now one revalidation, and every read on the screen sees one revision instead of possibly two.
  A commit republishes the memo, so a request always reads its own write, and a lost commit drops it, so a retry re-runs against the dataset that beat it.
  Blobs payloads are serialized compact for the same reason (`store-local.ts` stays pretty-printed): every commit uploads the whole dataset, every tap is a commit, and `KEPT_REVISIONS` copies trail behind each one.
  `netlify blobs:get treebed rev/<n> | jq` covers the readability.
  Growth is still linear in lifetime taps — `events` is append-only with nothing pruning it — which is fine at pilot scale and is the thing to revisit (a separate append-only key, or sampling) before traffic accumulates.
- **Business rules live in `src/lib/service.ts`, never in the store and never in the client.**
  Two-slot cap, one-report-per-person-per-bed-per-NY-day, single open report per bed, escalate-to-dumping-once, one photo per NY week, PIN hashing.
  Anything in the browser is editable in devtools (spec §7).
- **A rule that checks state before writing it runs inside `store.transaction()`, and reads and writes through the `tx` the callback is handed — never through the store it came from.**
  A bare sequence of store calls interleaves with concurrent requests, and two reports open on one bed is unrecoverable through the UI — `closeReport` only ever finds the first.
  `tx` is a distinct object precisely so a call arriving from another request while the transaction waits on its disk write is still recognized as somebody else's and queued.
  Any new `Store` implementation must make the callback exclusive and commit or roll back its writes as a unit.
  Every mutation goes this way, including the per-tap event — a write outside the committed path can be discarded by an unrelated rollback.
- **Store reads return detached copies.** Mutating what a read handed you changes nothing; the only way to persist is an explicit write.
  This is what keeps the service layer honest against a backend that can't hand out live references.
- **`events` is append-only.** The store deliberately has no update/delete for events.
- Anonymous visitors get an HMAC-signed `tg_visitor` cookie so the daily report limit has an identity to hang on.
  Known MVP limitation: clearing cookies mints a new identity; the limit is best-effort for anonymous users.
- **A write a cookie-less caller can repeat reads the actor with `getExistingActorId`, not `getActorId` — with `/report` as the one deliberate exception.**
  `getActorId` mints a visitor id when there isn't one, which on a write path hands a caller that sends no cookie a fresh identity every request — the rule then bounds nothing.
  `/confirm` and `/escalate` therefore perform no write for a cookie-less POST and redirect like any other no-op action; a real neighbour always has the cookie, because the plaque GET they pressed the button on set it, so the approved one-tap UX is unchanged and signed-in users never reach the gate at all.
  Filing a report is the exception because the trade is not the same one: a confirm the server declines to count costs a visitor nothing they came for, while a report it declines to file is the product.
  So `/report` mints (`getActorId`), a cookie-less POST files, and the one-per-person-per-NY-day limit is best-effort for anonymous callers — the same concession already recorded above for the visitor cookie. Don't "fix" that line into `getExistingActorId`; it would silently stop anonymous filing, which is the core street action.
  This is a bound, not tamper-proofing: a script that keeps a cookie jar per identity still inflates the confirm count, exactly as it can still refile past the daily limit. It is the same best-effort tier as the visitor cookie itself, and what it buys is that the trivial version — no cookies at all — writes nothing. `MAX_CONFIRMATIONS` (service.ts) is what makes the cost finite where the write is a growing array — the stored array, the events beside it, and the number on the public screen all stop growing there.
- **`/clear` is gated on a signed-in adopter of that bed, and anonymous clear is deferred by decision — not missing by accident.**
  Spec §2's "anyone can mark clear" is deliberately not implemented at the route right now. `closeReport` itself is unchanged and still actor-agnostic: the capability is intact in the service layer, only the route is closed, so re-opening it is a routing change and not a rules rewrite.
  A cookie gate is not enough here, which is why this one is auth-gated where `/confirm` and `/escalate` are not. Closing a report is what lets the next one be filed, so `report → clear → report` is a loop with no UI behind it, and each lap appends a `Report` and two `BedEvent`s to a history nothing prunes, each written by re-serializing the whole file — the cost of an injected record grows with the records already injected. `/report` mints deliberately, so a cookie-less caller files freely; one GET buys the visitor cookie that a `getExistingActorId` gate on `/clear` would ask for, and the loop runs unchanged. Auth ends it instead of rationing it, and costs no approved screen: the only clear button in the build is on the guardian view (`mine.astro`), behind a session and an adopter check already.
  **Re-opening anonymous clear requires a storage bound as a precondition** — a generous per-bed daily cap on anonymous clears is the shape to use. Whoever re-opens it must not simply delete the two checks in `clear.ts`; without a bound underneath, that restores the unbounded loop verbatim.

## Security decisions (read before touching auth)

- **PIN auth is an MVP decision with a known weakness, not a considered long-term design.**
  The captain chose username + numeric PIN for the street MVP (replacing spec §2's magic-link plan).
  A 4–8 digit PIN is brute-forceable and there is no rate limiting on sign-in attempts yet.
  Revisit before any real rollout.
- PINs are bcrypt-hashed (`hashPin`/`verifyPin` in service.ts). Never store, log, or echo a plaintext PIN — the adopt form deliberately does not re-fill the PIN field on validation errors.
- **`MAX_INFLIGHT_PIN_HASHES` (service.ts, 4) bounds the backlog a PIN hash can build, not how many PINs may be tried and not the CPU itself.**
  `request-body.ts` bounds bytes, time and concurrency for every public POST, but it releases a read's share of `MAX_INFLIGHT_BODY_BYTES` before any rule runs, and a bcrypt is ~150–300ms of the one thread that also serves every tap.
  So `/auth` and `/adopt` were the one place an anonymous caller could still queue unbounded work: a few dozen POSTs a second saturate the loop and every tap, report and confirm stalls behind however many hashes the flood managed to start.
  Past the bound the request is shed rather than queued — waiting in line for a saturated CPU is the stall, not the cure — and `signIn` takes its slot *before* the username lookup, so being shed can't reveal what the constant-time compare below is there to hide.
  What that buys is bounded queue depth and bounded added latency, not a bounded share of the CPU: bcryptjs yields to the event loop once per 100ms of synchronous work (`MAX_EXECUTION_TIME`), not per round, so four admitted hashes still keep the thread in bcrypt nearly continuously. A tap arriving mid-flood waits behind at most four hashes — a few hundred milliseconds — instead of behind an unbounded queue. The plaque, the report and the confirm stay usable under load; they do not stay fast.
  The other side of that trade, deliberately: a sustained anonymous flood holds sign-in and adoption at their busy screens for as long as it lasts. Auth loses to the tap/report path, which is the whole reason the bound sheds. Per-IP limiting at the platform tier is the eventual remedy, alongside the per-PIN and per-account rate limiting that is still absent and still owed before any real rollout — this bounds the cost of attempts, not their number.
  Both screens answer it themselves: the sign-in form and the adopt form come back with a 503, `retry-after`, and everything the visitor typed except the PIN. Shedding logs at most one line a minute, carrying the number shed since the last one: the node adapter writes no access log, so 503s are otherwise invisible from the box, but a line per refusal would let an anonymous flood decide how much stderr it costs us — the same reason `request-body.ts` says nothing at all for a `busy` refusal.
  How many hashes overlap depends on how fast the box is, so the end-to-end proof of what a shed visitor receives runs against a server started with `TREEBED_MAX_INFLIGHT_PIN_HASHES=0` — a test seam like the two in `request-body.ts`, not a deployment knob. Zero stays legal for exactly that reason, and it is announced the same way the session secret is: `scripts/preflight.mjs` warns before the port is bound under `npm start` / `npm run preview`, and `warnIfPinHashingDisabled` (called from `src/middleware.ts`) covers a server started any other way.
  That second one is *not* a boot warning and neither is the session-secret assertion beside it — measured against the built bundle, the node adapter imports the middleware lazily (`middleware: () => import("./virtual_astro_middleware.mjs")`), so both speak on the first request of any route. Nothing inside the app can speak earlier; preflight is the only code that runs before the server listens.
- `signIn` runs a bcrypt compare even when the username is unknown, so unknown-user and wrong-PIN cost the same. Don't "optimize" that short circuit back in — without rate limiting it is the only thing making username enumeration expensive.
  `adoptBed` keeps the same price on the same question: its pre-filter checks only that the bed exists and has a slot free, and `username-taken` is answered from inside the transaction, past the hash. Reading the username cheaply up front would be a second, free oracle for the question `signIn` charges a bcrypt for, and it sheds nothing anyway — a flood sends handles nobody holds, so they pass the check and buy the hash regardless. The bed and slot legs are the ones that shed: once both slots are taken, every further POST refuses before hashing.
- `TREEBED_SESSION_SECRET` is required in production; the app refuses to sign cookies with a generated one. The `.data/session-secret` fallback is dev-only.
  The requirement is checked twice so a misconfigured deploy can't reach traffic: `scripts/preflight.mjs` runs as npm's `prestart` and `prepreview` and refuses to boot, and `src/middleware.ts` asserts at module load so a server started any other way fails on its first request of any route rather than on the first one that touches a cookie.
- **Every public POST reads its body through `src/lib/request-body.ts`, never `request.formData()` directly** — the adapter's own default limit is 1GB of buffered memory.
  The comment block at the top of that file is the whole-surface sweep — size, time, concurrency, peak heap, and what the caller sees for every publicly reachable route — and a new route belongs in it.
  Four bounds, because three rounds of review each found one of them missing somewhere: a byte cap per body, a time bound on *both* the accepted and the refused read, an in-flight byte budget across all reads at once, and the drain headroom below.
- **The photo cap is per target: 12MB on node, 4MB on netlify.**
  Netlify caps a synchronous function's request payload at 6MB and buffers the body before the function is invoked, so a larger upload never reaches the route: the platform answers a bare 413 and `too-large.astro` — whose whole point is handing the visitor back the report they already filled in — never renders.
  Set below the platform's own limit, every refusal a visitor can provoke is one this route makes gracefully.
  The streaming bounds below are measured against the node adapter's real sockets either way; on netlify the body has already been buffered by the platform by the time we read it, so what they buy there is the graceful screen, not the heap.
  Every bound in this section, and `MAX_INFLIGHT_PIN_HASHES` above, is a module-level counter, so it bounds one process: the whole server on the node target (what `npm start` runs and what the e2e suite measures), one function instance on netlify.
  Fleet-wide peak heap and bcrypt concurrency there are these numbers times however many instances the platform is running, and a single warm instance serving concurrent invocations sheds legitimate sign-ins at the hash limit exactly as it sheds a flood.
  They are per-instance costs, not the pilot's surface-wide DoS ceiling — bounding the surface is the per-IP limiting at the platform tier already noted as owed.
- The report route never buffers the photo. `readCappedHead` counts the bytes and keeps only the first `HEAD_BYTES`, which is where the severity and the filename are, so a 12MB upload costs kilobytes instead of the 24–36MB that buffering plus `formData()` cost (~30MB measured per upload).
  The photo is discarded either way (spec §12) — this only stops it being copied on the way to being discarded.
  `readCappedForm` still buffers the text-only forms, where the whole body is 64KB and two copies of it are ~128KB.
- A refused body is read to its end and discarded rather than cancelled: cancelling the reader destroys the socket, and a client still uploading gets a connection reset instead of the response.
  The drain budget is absolute, not a multiple of the cap — 24MB of headroom on the report route (covering the 12–30MB a real phone photo lands in), the cap itself on the text-only forms — and bounded in time as well: `DRAIN_IDLE_MS` for a sender that goes quiet, `DRAIN_TIMEOUT_MS` in all, both under Node's own 300s request timeout and both above what a slow phone upload needs.
  `DRAIN_TIMEOUT_MS` is a budget for the drain, not an extension of the request: the drain deadline is clamped to `READ_TIMEOUT_MS` measured from the start of the read, so a body that crosses the cap late can't run `time-until-over + 180s` past the 300s backstop and lose the very screen the drain exists to deliver.
  `READ_IDLE_MS`/`READ_TIMEOUT_MS` are the same bounds on a body nothing has refused — an 11.9MB trickle is under the cap and still may not hold a request open forever.
  Those four are the report route's, sized for a 12MB photo on a bad uplink. Every other public POST reads under `FORM_READ_TIMEOUT_MS`/`FORM_READ_IDLE_MS` (10s/5s, drain included), because the bound that fires is also the bound that releases the read's share of `MAX_INFLIGHT_BODY_BYTES`: on the photo-sized clocks, a cookie-less client trickling a byte every 25s held a reservation for four minutes per socket, so a few hundred of them at ~40 bytes/sec together exhausted the budget and every public POST answered `busy` until they timed out. Heap stayed bounded; availability did not. A body that can only be one button or five typed fields gets seconds.
  The report route's minutes are earned rather than granted, for the same reason: until the first `HEAD_BYTES` are in, every read — that one included — is on `HEAD_READ_TIMEOUT_MS`/`HEAD_READ_IDLE_MS` (the same 10s/5s), on the drain as well as the accepted path. A phone puts the head of a 20MB upload on the wire in well under a second and a report with no photo is a few hundred bytes in total, so the realistic cases are untouched; what the head phase removes is the one route where four minutes could be held for a body that never showed a photo at all, which made `/report` the cheapest reservation on the surface at ~30 bytes/sec across a few hundred sockets.
  Residual, accepted: past the head the long clocks are back, so a client willing to push 8KB per socket first can still hold reservations at a few tens of KB/s. That is three orders of magnitude dearer than the trickle it replaces, and closing it further means a sustained-throughput floor, which is a bound value the captain owns and a risk to the slow-uplink photo the graceful screen exists for.
  Past a bound the read stops and does *not* cancel: cancelling leaves the response unwritten and the socket idling until that 300s timeout, while walking away lets the route answer and lets Node close the connection behind a request body it never finished. Measured both ways — `tests/report-upload.e2e.test.ts` posts real bodies at a real server, because this is not a thing to reason about.
- `MAX_INFLIGHT_BODY_BYTES` is what one request's cap can't bound: how many arrive at once.
  Each read reserves what it may hold *at its peak* — `2 ×` the cap when buffering (the chunks, then the merged copy), `HEAD_BYTES` when head-only, and `CHUNK_ALLOWANCE_BYTES` either way for the chunk in hand — and it caps concurrency in the unit that matters (hundreds of head-only uploads fit; a buffering route gets a handful).
  Reserving only the bytes a read means to *keep* under-counted the report route by 8–16×, which is the same as not having the bound.
- `MAX_INFLIGHT_BODY_BYTES` covers admitted reads only; `MAX_SHED_READS` (64) bounds the refused ones, which each hold a head plus the chunk in hand while they shed.
  The peak heap for every read holding anything is the two together: 48MB + 64 × 72KB, about 52MB. Neither number means anything without the other — a budget that bounds only what it admits is bypassed by everything it turns away.
  Past `MAX_SHED_READS` at once a read keeps nothing — no reservation, no head, so on `/report` the screen loses its severity — and stops at `SHED_DRAIN_BYTES`/`SHED_DRAIN_MS`.
  It does still read that much, and must: **a request body the app never touches is not a body the server never receives.** Node dumps the body of any request whose response finished unconsumed, which resumes the socket and reads it to the end — measured at a full 200MB of ingress for one refused POST, bounded by nothing but Node's own 300s timeout. Taking the first chunk ourselves is what marks the body consumed and puts the stopping point back in our hands.
  Both halves are measured over a real socket in `tests/report-upload.e2e.test.ts` (`TREEBED_MAX_INFLIGHT_BODY_BYTES` / `TREEBED_MAX_SHED_READS` exist so that path can be driven with two sockets instead of several hundred; they are test seams, not deployment knobs): the connection stays live, the busy screen arrives, and the server takes kilobytes of a 200MB upload rather than all of it.
- A read refused as `'busy'` drains on `BUSY_DRAIN_BYTES`/`BUSY_DRAIN_MS`, not the headroom the other refusals get.
  Refusing a body and then spending an admitted upload's worth of ingress on it sheds no load at all.
  Everything carrying something a person typed is far under that and still gets its answer; a multi-megabyte photo arriving while the server is full is the one case whose connection closes, and at capacity that is the answer rather than a courtesy owed.
- Each refusal is its own answer: on `/report` every one of them reaches the too-large screen with the severity preserved, because the head holds it whichever way the upload ended and the report is what is being rescued — the one exception being a read past `MAX_SHED_READS`, which keeps no head, so its `?reason=busy` screen offers the picker again instead of the one-tap refile.
  `?reason` picks the words — nothing (a photo to shrink), `busy` (a queue to retry), `incomplete` (an upload that stopped halfway, which is *not* to be blamed on a photo that may have been well under the cap).
  The text-only forms answer in plain text instead (413/408/503/400) because there is no filled-in report behind them to preserve.
  A read that *fails* is not an oversized body, and an oversized body whose sender then hangs up is not a failed read — that one keeps `'over-limit'` and logs one quiet line, because a visitor closing the tab on a refused upload is not an incident.
- Tap counting must be wrong in neither direction, and `src/lib/plaque-url.ts` is the one place that decides it.
  Every POST route that sends someone back to the plaque and every link back to it from one of our own screens builds the URL with `ourPlaqueLink` — one function, because it answers one question — and the plaque suppresses its tap event only for the flags in `POST_ACTION_FLAGS`.
  Suppressing on "the URL has a query string" would drop every tap from a decorated tag URL (UTM, Popl, a link shortener); matching only the flags that flash something counted one visit twice every time a rule sent a visitor back with nothing to say.
  A link back counts as ours for the same reason a redirect does — somebody already on the receipt or the sign-in form had their tap counted when they arrived — and it is the commonest flow of all: tap, file, read the receipt, press "just passing through".
  The site root redirects through `ourPlaqueLink` too: a tag never sends anyone to `/`, so what does is an uptime check, a crawler, or somebody typing the domain, and a monitor polling it once a minute would be 1,440 taps a day on the only seeded bed.
  Known residual, accepted rather than fixed: because the flag rides the URL, a visitor who uses an in-app back-link is left with `?tg_action=1` in the address bar, so a later return through history, a bookmark or a shared link renders the plaque without logging a tap — a small under-count in the opposite direction. The NFC tag always sends the bare URL, so the primary metric path is unaffected, and the alternatives (a Referer check, a short-lived nav cookie) are each less reliable and less legible than one flag in one place.
- Email and phone are PII: stored on the user record, never rendered on any public screen, never included in any client-visible payload. Only name/username is engraved, and only while `displayNameHidden` is false.

## Design tokens

- The palette in `src/styles/global.css` is the **prototype's rendered palette**, which deliberately diverges from the production site's brand tokens.
  The captain approved the prototype's look; firstmate has flagged the divergence upstream.
  Each token's comment records the brand value it diverges from — a future snap to brand palette is that one file.
- Fonts are self-hosted subsets (Nunito variable 700–900, Space Mono 400/700); provenance pinned in `public/fonts/README.md`.
  No Google Fonts CDN. Bebas Neue is intentionally absent — the prototype doesn't use it despite spec §3a.
- The bed screen's oversized action buttons are the captain's explicit override of the prototype's 66px buttons ("buttons taking close to as much of the screen as they can"). Don't shrink them back to match the prototype.
- `b/[plate]/too-large.astro` is the one screen with no prototype counterpart: where a refused upload lands.
  Filing is the core street action, so an optional attachment must never cost someone the report they already filled in — the screen carries their chosen severity and offers to file it without the photo.
  `?reason=busy` (the server was at capacity) and `?reason=incomplete` (the upload stalled or broke off) are the same screen for the other two refusals, each with its own copy: nothing is gained by telling somebody to shrink a photo that was never the problem.
  It is built from the same tokens as the rate-limited screen and, like every other screen, works with JavaScript disabled.

## Scope deliberately left out (later tasks)

- Supabase/Postgres/PostGIS, R2, any hosted service — the store swap is designed for this.
- Photo storage (the report sheet's attach affordance records only `photoAttached`), points/streak earning rules, the 1-day grace period, 311 handoff, admin dashboard, NFC tag cryptographic verification, provisioning flow.
- Streak/points on the adopter view render stored values only; nothing increments them yet.

## Seed data

One hand-seeded bed `BED-HRL-0847`, with seeded adopter `marisol_r`.
On the local store it is created on first boot with PIN `1234` — demo credentials for driving the sign-in flow locally.

**`BlobsStore` seeds the same adopter with no PIN anybody knows** (a hash of random bytes), because that store is the publicly tappable one: the plaque engraves `@marisol_r`, sign-in has no rate limiting yet, and a well-known PIN there would be an open guardian account on the internet — `/mine`, `/photo`, and the deliberately auth-gated `/clear`.
`TREEBED_SEED_PIN` is a **development-only** seam, for driving the sign-in flow against a store that seeds without one.
It is unset on the Netlify site and must never be set there: a PIN supplied to the publicly tappable store is the open guardian account this seed exists to avoid.
That is enforced in code rather than by this paragraph — `seed()` reads the variable only on the node target (`BUILD_TARGET`, the same shape as the store-selection assertion), so a production build ignores it however it is set.

The pilot store was seeded *before* this change — seeding only ever runs on first contact — so it held the `1234` hash.
**That is remediated: `marisol_r`'s `pinHash` was rotated in place** by appending a revision copying the newest one with the hash replaced by a bcrypt of discarded random bytes.
Signing in with `1234` on the live site now fails, and the pilot's data (report, events, adoption) came through intact.
Rotating a hash forward is the procedure to repeat if it is ever needed again — do not wipe the store to re-seed it.

If a store genuinely has to be re-seeded, **delete the `head` key alongside the `rev/*` keys.**
A surviving `head` is the store's own proof that it has been written to, and `BlobsStore` refuses to seed once it has read one — deliberately, because a key listing is eventually consistent and a stale-empty one would otherwise fork a fresh chain over live data.

## Deployment (pilot)

- Production is the Netlify site **`treebed-plaque`** (site id `449a9585-ae51-4e23-9614-fe5b3ac669f1`), live at <https://treebed-plaque.netlify.app>, resolved for wayfinder ticket #8.
  **The site `trashtalknyc` (id `77ee72e0-18f8-43b7-a338-9b5d67d40236`) is the org's public website — a different product. Never deploy this app there.**
- Deploys are CLI-driven, not repo-linked: `NETLIFY_SITE_ID=449a9585-ae51-4e23-9614-fe5b3ac669f1 npx netlify-cli@latest deploy --build --prod` from a checkout on Node >= 22.
  `netlify.toml` carries the build command, the publish dir, and the environment that selects the netlify adapter — the CLI applies it, so no flags beyond the site id are needed.
- Site environment variables (set via `netlify env:set`, all already in place): `TREEBED_SESSION_SECRET` (secret, generated — never in the repo) and `TREEBED_STORE=blobs`.
  `AWS_LAMBDA_JS_RUNTIME=nodejs22.x` — functions default to an older Node than `engines` demands — lives in `netlify.toml` beside `NODE_VERSION` instead, so a recreated or duplicated site gets the right functions runtime without anyone remembering an `env:set`.
- The custom domain (`trashtalknyc.org/t/*` proxying, per ticket #5) is deliberately not wired yet; the `/b/[plate]` → `/t/[tag]` re-key is its own ticket.

## Branching model

The promotion chain is strict and linear:

```
feature branch -> dev -> qa -> stage -> prod
```

- `dev` is the repository's default branch and the **only** branch feature work merges into.
  Feature branches are cut from `dev` and PR back into `dev`.
- `qa` receives promotions from `dev` only.
- `stage` receives promotions from `qa` only.
- `prod` receives promotions from `stage`, plus `hotfix/*` branches as the one sanctioned exception; it is what is live.
- `main` is kept as a **mirror of `prod`** (the conventional default name pointing at what is live).
  It is never a merge target for feature work; the only valid PR into `main` comes from `prod`.

**Open every feature-work pull request against `dev`, never against `main`.**
This applies to agents and automation as much as to humans: tooling that picks a base branch by the conventional name `main` picks the wrong one here, because in this repo `main` is the prod mirror and `dev` is the default branch.
Targeting `main` from a feature branch is what a red promotion-chain check almost always means; the fix is to retarget the pull request to `dev`, not to change the check.

Forward promotion moves **up** the chain and always requires the exact predecessor, so nothing is promoted into `prod` without passing through `qa` and `stage`.
The `hotfix/*` -> `prod` exception is the one way around that, and it is trusted **by branch name alone** — the check never verifies where a `hotfix/*` branch was cut from or what it contains, so any branch named `hotfix/anything` merges straight into `prod`.
That is the deliberate cost of having a fast path at all.
Merges **down** the chain are valid by design: `prod` -> `stage` and `stage` -> `qa` are back-merges, and the check accepts them alongside each base's forward source.

Hotfix path: cut `hotfix/*` from `prod`, PR it into `prod`, then PR `prod` -> `main` to re-establish the mirror, then back-merge `prod` down through `stage`, `qa`, and `dev`.
Skipping the back-merge means the next normal promotion silently reverts the fix; skipping the `main` sync leaves `main` no longer mirroring live code.
Each of those PRs is an accepted source, so the sanctioned procedure never requires merging past a failing check.

### What CI actually does, and what it cannot do

`.github/workflows/promotion-chain.yml` **flags** a pull request into `qa`, `stage`, `prod`, or `main` whose head branch is not a valid source: it surfaces the violation as a failed check on the PR.
Valid sources per base: `qa` <- `dev` or `stage`; `stage` <- `qa` or `prod`; `prod` <- `stage` or `hotfix/*`; `main` <- `prod`.
PRs into `dev` are deliberately unchecked because feature branch names are arbitrary.

The trigger has **no `branches:` filter**; the base branch is filtered inside the script, which passes any base outside the chain.
This is load-bearing rather than stylistic.
With a `branches:` filter, retargeting a PR off a guarded base (the fix for an out-of-chain PR, e.g. `main` -> `dev`) matches no event, so no new run reports on the unchanged head SHA and the earlier failed check stays red on a PR that is now correct.
Running on every PR keeps the check an answer about the current base.

The check is **advisory only — it cannot prevent anything.**
GitHub branch protection, rulesets, and required status checks all return `403 Upgrade to GitHub Pro or make this repository public` because the Trash-Talk-NYC org is on a free plan and this repo is private.
That single limitation has three consequences:

- A red promotion-chain run leaves the merge button fully enabled.
  Anyone with write access can merge an out-of-chain PR straight past the failing check.
- Nothing observes **direct pushes** to `qa`, `stage`, `prod`, or `main`.
  The workflow only runs on pull requests.
- For `pull_request` events the workflow definition is resolved from the PR merge ref, so a head branch that deletes or renames `.github/workflows/promotion-chain.yml` produces a PR with **no** promotion-chain check at all rather than a failing one — an absent check is not proof the chain was followed.

Leaving the chain advisory is a **deliberate accepted risk** taken by the captain (small team, nothing deployed yet), not an oversight.
If the repo ever goes public or the org upgrades to a paid plan, replace this check with real branch protection / rulesets and mark it a required status check.
