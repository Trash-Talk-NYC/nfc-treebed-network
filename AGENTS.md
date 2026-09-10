# NFC Tree Bed Network — agent notes

The post-tap experience for Trash Talk NYC's NFC tree bed network.
A pedestrian taps a tag on a tree guard and lands on `/t/<tag>` — an opaque 8-character tag ID, e.g. `/t/2mq2amhv` (production host `https://trashtalknyc.org/t/<id>`; the custom domain is separate work).
The bed's plate (`BED-HRL-0847`) is an INTERNAL join key and is never rendered — see "The tag URL" and "The two doors" below.

**Every feature-work pull request is opened against `dev`, never against `main`** — `dev` is the default branch and `main` mirrors `prod`.
This is repeated here, at the top, because automation that picks a base by the conventional name `main` fails the promotion-chain check, and by then the base is already wrong; see "Branching model" below for the whole chain and for the retarget that clears it.
A checkout made before `dev` became the default still caches `main` in `remote.origin.HEAD`, which is what base-picking tooling reads, so run `git remote set-head origin -a` in any clone that offers `main` — `git ls-remote --symref origin HEAD` is the read-only check.

Source-of-truth documents live in the firstmate repo:
- `data/tap-flow-decision/approved-screens.html` — the approved screens, iterated on directly by the captain across roughly forty rounds. Authoritative for visuals, copy and flow. **Open it in a browser before changing a screen.**
- `data/tap-flow-decision/design-record.md` — the numbered constraints the captain agreed, with the reasoning, plus the three open questions he answered "undecided, knowingly so" and the safe default each one obliges.
- `data/plaque-mvp-n4/spec.md` — product intent and the server-side rules, still current below the screens.
- `data/block-admin-w171/approved-screens.html` — the approved BLOCK ADMIN screens (section 1: desktop, plus the phone flow further down) and `data/block-admin-w171/design-record.md`, the constraint record that governs them.
The prototype in `data/plaque-mvp-n4/prototype/` is the SCRAPPED Option A plaque and is no longer authoritative for anything.

## The two doors (read before touching a screen)

The tap resolves to a bed server-side and the bed's state picks one of two screens (`src/pages/t/[tag]/index.astro`):

- **no steward yet** → "This <tree>'s bed is looking for a steward." → `ADOPT THIS BED` / `THIS BED NEEDS CARE`
- **already stewarded** → "This <tree> bed has been adopted!" with the stewards shown → `SEND APPLAUSE` / `THIS BED NEEDS CARE`

Both doors withhold the adoption invitation on a bed with no offered slot open (`BedView.openSlots`, from `min(slots, offeredSlots)` — see "The block admin" below): door 1 says "isn't open for adoption yet" (`DOOR_NOT_OFFERED`) and offers care alone, and door 2 drops "join them".
An unoffered bed is a normal state — the six W 171st beds seed that way — not a bed to be "fixed" by restoring the button the rules would then refuse.

**The two doors stand on different grounds, deliberately.**
Door 1 is Poster Beige — the page ground — with no highlight on the tree type, so its headline reads as one plain sentence; its buttons are the page ground's pair, Deep Purple for adopt and a Roadtop Black outline for care.
Door 2 is Post No Bills Green with the tree type picked out in beige (`.hl`).
The captain changed door 1 to beige after the review; it is not an oversight to normalize, and `.hl` does not go back on it — `tests/steward-privacy.e2e.test.ts` asserts the ground, the button pair and the absent highlight in both languages.
No yellow appears on door 1 at all, which is what keeps it clear of the one pairing that cannot work on that ground.

`THIS BED NEEDS CARE` opens the problem picker (`care.astro`): thirsty plants / litter / guard damage / something else, plus an optional photo.
The picker is MULTI-select — the tiles are checkboxes and a report carries `categories`, a non-empty list in tile order (a bed that is thirsty AND full of litter is one report); an empty submission is the server's refusal, back to the picker with the bilingual pick-one line, because checkboxes have no `required` that means "at least one".
"Something else" is a GET submit of the same form back to `?tell=1`, which is the same route rendering the free-text box — a form GET rather than a link or a script, so the second screen exists with JavaScript disabled AND the tiles already pressed ride its query string (a link's href cannot know what is checked); the sentence screen sends them back out as hidden fields beside `other`, and a hidden `lang` field carries the language because a GET replaces its action's query string.
Both send to `report.ts`, which lands on the full-screen "Thank you" (`thanks.astro`).
Under both doors' buttons sits one small text link to "About this bed" (`/t/<tag>/about`) — the bed's profile and the network FAQ, never a third big button; see "The block admin" for the data behind it.
Adoption lands on the full-screen purple "Adopted!" (`adopted.astro`).

**Option A — the old plaque-first screen — is scrapped, not flagged off. Do not restore it.**
With it went the visitor-facing confirm, escalate, receipt and rate-limited screens, which the approved flow has no place for.
Their RULES are untouched in `service.ts` (`escalateReport`, `closeReport`), the same way anonymous clear is kept as a capability behind a closed route; only the routes are gone.
**`escalateReport` and `closeReport` are deliberately kept with no visitor route — they are not dead code, and re-raising them as such is re-litigating this decision.** (`confirmReport` was NOT one of them: `reportProblem` absorbed its logic inline, and it is gone.)

Two consequences worth knowing before you "fix" something:
- **A second neighbour reporting an open problem is not refused.**
  `reportProblem` adds their weight to the open report (the `confirmedBy` array, same `MAX_CONFIRMATIONS` bound) instead of opening a duplicate — two open reports on one bed is unrecoverable through the UI, because `closeReport` only ever finds the first.
  What they said is carried, not dropped: their categories and their note ride on the `confirm` event (`BedEvent.categories` / `BedEvent.note`), and a photo they attached sets `photoAttached` on the open report.
  The steward reads them under the open-report band on `mine.astro`, headed "Neighbours also said" so they are not mistaken for the first reporter's own second thought.
  Which report an event is about is `BedEvent.reportId` — `report`, `confirm`, `escalate` and `clear` all name it — so that join is exact rather than a time window — `report → clear → report` is a supported loop and only the id says which lap an event belongs to.
  Events written before that field carry null and match nothing, which is the right way for it to degrade.
  The note is capped at `MAX_NOTE_CHARS` and the confirmations are bounded, so carrying the payload reopens no growth concern.
- **Nobody standing at a tree is shown a rule.**
  A second send the same NY day writes nothing and still lands on the thank-you takeover.
  What the press was worth is legible in the record and the events, not in a notice.

## Bilingual, with a visible toggle

**Every visitor-facing string exists in English and Spanish, and an untranslated one is a defect, not a follow-up** (design-record.md, constraint 11).
Washington Heights is heavily Spanish-speaking.

- All copy lives in `src/lib/copy.ts` as `Phrase` (`{en, es}`) values, so there is no way to write an English string without its Spanish.
  `tests/i18n.test.ts` additionally fails on an empty value or one copied across untranslated.
- `src/lib/i18n.ts` resolves the language: `?lang=` on the URL first (what each of the toggle's two links carries), then the `tg_lang` cookie, then English.
  **Nothing reads `accept-language`** — the captain asked for a toggle the visitor operates, and a phone set to English in a Spanish-speaking household is common on this block.
- Screens render the active language AND carry both in `data-en` / `data-es` attributes (`src/lib/bilingual.ts`), the same pattern the sister property `trashtalknyc-website` uses.
  The server render is what makes it correct with no script; the one inline script in `Screen.astro` upgrades the toggle to an instant, no-reload swap.
  **A bilingual element must be a LEAF node** — the swap sets `textContent` — which is why a sentence wrapping the tree type is split into leaves either side of it.
  Visitor-supplied text is the one thing that carries no `data-en`/`data-es` pair: a bed's given name (`Bed.bedName`) renders as typed in both languages, on its own leaf, never inside one of our sentences.
- Every link and redirect of ours carries the language through `langLink` / `withLang`, which preserve whatever else the URL held — including `tg_action`, without which a language switch would log a second tap (`plaque-url.ts`).
- Plain-text refusals for machine callers (405, "Not a tag on this network.") are deliberately English-only: nothing renders those to a person.
- A bed's Spanish species name defaults from the checked-in table in `src/lib/tree-species.ts` when a bed is added: an explicitly typed Spanish name wins, and an unknown species degrades to the generic "árbol" — never a guess, a transliteration, or a runtime translation.
  Stored values are lowercase, because their commonest use is mid-sentence in that same frame; the screens that print the species STANDALONE — the steward's own heading and the admin bed labels — capitalize at the render site with `capitalizeFirst` (`format.ts`), never with CSS and never by changing what is stored.
  The table holds only names that sit after the door copy's fixed masculine "El cantero de este …", so species whose accepted Spanish names are all feminine (honeylocust, black locust, mulberry, catalpa, zelkova…) are deliberately absent; adding one means first teaching the copy gender agreement, not bending the name.

## Presentation is data-driven, not hardcoded

**No colour, logo or wordmark is named anywhere but `src/lib/presentation.ts`.** Every bed returns the same defaults today and grouping is deliberately NOT built; what this buys is that giving a block or a sponsor its own look later is a new lookup rather than an unpicking job across every screen.
`themeStyle` writes the roles onto the root element as `--theme-*` custom properties and the stylesheet reads them.
`tests/presentation.test.ts` fails the build on a hex value anywhere else under `src/`, and holds every text/background pair to WCAG AA.
`Presentation.logo` and `public/img/trash-talk-nyc-logo.png` are part of that seam and are kept on purpose although no approved screen renders a logo yet: a sponsor's or a block's mark must be a lookup here, not a rewrite. Do not delete them as dead weight.

## Stack

- Astro (server-rendered) + TypeScript strict, with two build targets selected in `astro.config.mjs` by `TREEBED_ADAPTER`:
  `node` (the default — `@astrojs/node` standalone server, what `npm start`, `npm run preview` and the e2e suite run) and `netlify` (`@astrojs/netlify`, what production deploys; `netlify.toml` sets the variable for every Netlify build).
  The node target stays first-class rather than becoming a dev shim because the request-body bounds below are measured against its real sockets.
- **`astro`, both adapters, and `@netlify/blobs` are pinned to exact versions**, and for the same reason: an adapter consumes astro's app API through a permissive peer range, so a version that satisfies the range can still break the built server at boot.
  `@astrojs/node` is pinned to 11.1.1 because 11.1.4 calls `app.getLogger()`, which `astro` 7.2.1 does not have — measured, not hypothetical.
  `@astrojs/netlify` is pinned to 8.2.3 against the same trap on the adapter production actually deploys with, where the break would first appear live.
  `astro` itself is pinned to 7.2.1 because a caret is the same mismatch from the other side: `npm update` or any lockfile refresh would move astro under two adapters verified only against this version.
  `@netlify/blobs` is pinned to 10.7.13 because production's entire data path speaks it and its emulated server is what `tests/store-blobs.test.ts` proves `onlyIfNew` against — runtime and test wire behaviour should not stay aligned by luck of a shared range.
  The point of the policy is that moving any of the four is a deliberate act with a build behind it, not a side effect of an unrelated install. Upgrade astro and its adapters together, and re-pin rather than un-pin.
- Requires Node >= 22 (`~/.nvm/versions/node/v22.23.1` works; the default shell Node 18.10 does not).
- `npm run dev` / `npm run build` / `npm run preview` / `npm test` (vitest) / `npm run test:e2e` / `npm run check` (astro check).
  `npm test` is the fast suite — rules and transport handling, no build — and `npm run test:e2e` builds the app, serves `dist/server/entry.mjs`, and posts real bodies at it (`vitest.e2e.config.ts`); CI runs both (`.github/workflows/tests.yml`).
  `npm run preview` and `npm start` both serve the production build, so both need `TREEBED_SESSION_SECRET` and both are gated by `scripts/preflight.mjs`.
  CI also runs `npm run test:netlify-build` after both suites, because every other step builds and exercises the node target only — the adapter production ships would otherwise be built for the first time by a manual deploy.
  That script builds the netlify target *and* runs `scripts/smoke-netlify.mjs`, which imports the emitted `.netlify/v1/functions/ssr/ssr.mjs` and renders one request through it: the break this repo actually hit (`app.getLogger()`) is a load-time crash that a build alone passes green, so the build without the boot would prove only that the adapter resolves and the bundle emits.
  The request it drives is the root redirect, the one route that reaches a rendered response without touching the store, so the gate needs no Blobs backend.
- The tap flow ships two small inline scripts and nothing else: the language toggle's instant swap (`Screen.astro`) and the care screen's photo-attached state plus note counter (`care.astro`).
  Both are enhancements. Every form is a plain HTML POST (plus the care picker's one GET submit, above), the language toggle is a pair of plain links — a two-state control showing both languages with the active one marked `aria-current`, per the captain's ask (`LangToggle.astro`; the admin bar carries the same shape) — and the whole flow works with JavaScript disabled — keep it that way; the spec calls it the single most important resilience decision in the build.

## The tag URL (read before touching routing)

- **The URL on a tag is `/t/<id>` and the ID is opaque — no meaning encoded, ever.**
  Locked on the wayfinder map (issue #3, decision 3; re-keyed from `/b/<plate>` in issue #5): the plate encodes site type and neighbourhood, and a tag's site is unknowable at encoding time — tags are bulk-encoded and may sit in the wood before a guard exists.
  Re-encoding means physically visiting every tag, so nothing may creep back into the URL.
  The format also has to tolerate NTAG424 query parameters later (map decision 4): route logic must ignore unknown query params, which is also why tap suppression matches only our own flags (`plaque-url.ts`).
- **ID format (issue #5, decided): 8 chars of Crockford base32, lowercase, alphabet `0-9a-z` minus `i l o u`.**
  `src/lib/tag-id.ts` normalizes lookups — case-insensitive, strips hyphens/spaces, maps `i`/`l`→`1` and `o`→`0` — so an ID typed off a sign still resolves; `u` has no mapping and is simply invalid.
  The plaque route redirects a non-canonical spelling to the canonical URL, query string intact — 302 for a GET or HEAD, 303 for anything that arrived with a body, so a client reading RFC 9110 doesn't repeat a POST at the one screen that logs a tap.
- **Tag → site is a binding, and only `src/lib/tag-bindings.ts` knows it.**
  A tag is a physical object, a site is a place; theft is expected.
  Retiring a stolen tag (`retiredAt`) and binding a replacement to the same plate loses no history, because reports and events are keyed by the plate, never the tag.
  The registry is a checked-in table *by decision*: the team binds pilot tags itself (map note 14 — paperwork binding suffices until ~tag twenty), the in-field claim flow is a later ticket, and until it lands nothing at runtime writes a binding.
  When that flow arrives, the binding moves behind the `Store` interface; `resolveTagParam` is the only thing the route helpers call and the only thing routes reach it through, so the swap is contained.
  The four W 171st IDs there were **minted in this repo ahead of the guards going in** — nothing was read off hardware — so for those rows the table is the SOURCE for what must be encoded onto the chips, not a record of what is already on them; whoever encodes them writes those exact IDs, and a mismatch is repaired by re-encoding the tag, never by editing a row.
- **An unbound tag is a normal state, not an error.**
  A well-formed ID with no active binding renders the calm "not assigned to a bed yet" screen (with the ID on it) at 404 — never a 500.
  It logs no tap: sites own history and an unbound tag has none to write to.
  POSTs at an unbound tag are answered before any rule runs, and pay `abandonBody`'s bounded drain (`request-body.ts`) for the body on the way out:
  a body the app never touches is one Node dumps to its end for us, so refusing without reading is the expensive answer rather than the free one.
  `requireBoundTagForPost` / `requireBoundTagForForm` / `requireBoundTagForView` (`src/lib/tag-route.ts`) are what every route behind `/t/<tag>` resolves through, which is where that ordering is kept.
  The three POST endpoints (`requireBoundTagForPost` — `report`, `applause`, `clear`) answer 404 in plain text — nothing is submitting a form there.
  The screens (`requireBoundTagForForm` / `requireBoundTagForView`) send the visitor to the door screen instead, which answers 404 itself, so the calm screen lives in exactly one place: 302 for a GET, 303 for a POST at `adopt` or `auth`.
  A bound tag whose BED has gone away — retired on the admin page — goes the same way, through `refuseMissingBedScreen`: every `/t/<tag>` screen hands the visitor to the door screen rather than a line of unstyled English, while the four POST endpoints keep their plain-text 404.
  An invalid ID — one no normalization can resolve — is 404 plain text everywhere, screens included: it is not on this network at all.

## Architecture invariants

- **All persistence goes through the `Store` interface in `src/lib/store.ts`.**
  The one deliberate exception is the tag→site registry above, checked in rather than stored, until the claim flow gives it a write path.
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
  Blobs' strong consistency covers `get`, not `list`, so a stale listing would hand a reader an older revision — the thank-you screen a POST just redirected to would render against an older bed — and would make `transaction` burn every attempt against a revision number somebody else already owns.
  A read instead takes the `head` pointer (a strongly consistent `get`, moved after each commit) as a *lower bound* and walks forward one `get` at a time until a revision is missing: the pointer may lag or be moved back a revision by a racing commit, the walk cannot, because a revision that exists is one `get` must return.
  The listing survives only as the fallback for a pointer that is missing or names a pruned revision, where being approximately right is enough to start the walk from.
  `tests/store-blobs.test.ts` drives both a lagging pointer and no pointer at all.
- **A request validates the dataset once, not once per read.**
  `src/middleware.ts` runs every route inside a `runInRequestContext` (`src/lib/request-context.ts`), and `BlobsStore` memoizes its validated read there.
  One door-screen render was six or more sequential Blobs round trips awaited before first paint, on cellular, for someone standing at the tree; it is now one revalidation, and every read on the screen sees one revision instead of possibly two.
  A commit republishes the memo, so a request always reads its own write, and a lost commit drops it, so a retry re-runs against the dataset that beat it.
  Blobs payloads are serialized compact for the same reason (`store-local.ts` stays pretty-printed): every commit uploads the whole dataset, every tap is a commit, and `KEPT_REVISIONS` copies trail behind each one.
  `netlify blobs:get treebed rev/<n> | jq` covers the readability.
  Growth is still linear in lifetime taps — `events` is append-only with nothing pruning it — which is fine at pilot scale and is the thing to revisit (a separate append-only key, or sampling) before traffic accumulates.
- **Business rules live in `src/lib/service.ts`, never in the store and never in the client.**
  The per-bed slot cap (`min(slots, offeredSlots)`, and `slots` itself bounded by `MAX_BED_SLOTS`), one-report-per-person-per-bed-per-NY-day, single open report per bed, one applause per person per bed per NY day, escalate-to-dumping-once, the note cap, the typed-field caps (`MAX_NAME_CHARS` / `MAX_EMAIL_CHARS` / `MAX_ADDRESS_CHARS` / `MAX_TREE_TYPE_CHARS` / `MAX_BED_NAME_CHARS` / `MAX_BED_NOTE_CHARS`, trimmed rather than refused), first-steward bed naming, PIN hashing.
  Every typed field — the visitor's care note included (`noteFrom`) — goes through `capped` (`typed-text.ts`), which DROPS the bidirectional-format overrides — they are zero-width — and COLLAPSES control characters and whitespace runs to a single space before it trims and cuts — a hand-built POST is the only thing that can carry a U+202E into a field that renders as a leaf beside copy of ours, and a textarea's own CRLF must stay a gap between two words rather than glue them together.
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
  `/applause` therefore performs no write for a cookie-less POST and redirects like any other no-op action; a real neighbour always has the cookie, because the door screen's GET they pressed the button on set it, so the approved one-tap UX is unchanged and signed-in users never reach the gate at all.
  Filing a report is the exception because the trade is not the same one: an applause the server declines to count costs a visitor nothing they came for, while a report it declines to file is the product.
  So `/report` mints (`getActorId`), a cookie-less POST files, and the one-per-person-per-NY-day limit is best-effort for anonymous callers — the same concession already recorded above for the visitor cookie. Don't "fix" that line into `getExistingActorId`; it would silently stop anonymous filing, which is the core street action.
  This is a bound, not tamper-proofing: a script that keeps a cookie jar per identity still inflates the weight on a report, exactly as it can still resend past the daily limit. It is the same best-effort tier as the visitor cookie itself, and what it buys is that the trivial version — no cookies at all — writes nothing. `MAX_CONFIRMATIONS` (service.ts) is what makes the cost finite where the write is a growing array — the stored array, the events beside it, and the number on the public screen all stop growing there.
- **`/clear` is gated on a signed-in steward of that bed, and anonymous clear is deferred by decision — not missing by accident.**
  Spec §2's "anyone can mark clear" is deliberately not implemented at the route right now. `closeReport` itself is unchanged and still actor-agnostic: the capability is intact in the service layer, only the route is closed, so re-opening it is a routing change and not a rules rewrite.
  A cookie gate is not enough here, which is why this one is auth-gated where `/applause` is not. Closing a report is what lets the next one be filed, so `report → clear → report` is a loop with no UI behind it, and each lap appends a `Report` and two `BedEvent`s to a history nothing prunes, each written by re-serializing the whole file — the cost of an injected record grows with the records already injected. `/report` mints deliberately, so a cookie-less caller files freely; one GET buys the visitor cookie that a `getExistingActorId` gate on `/clear` would ask for, and the loop runs unchanged. Auth ends it instead of rationing it, and costs no approved screen: the only clear button in the build is on the steward's own view (`mine.astro`), behind a session and a steward check already.
  **Re-opening anonymous clear requires a storage bound as a precondition** — a generous per-bed daily cap on anonymous clears is the shape to use. Whoever re-opens it must not simply delete the two checks in `clear.ts`; without a bound underneath, that restores the unbounded loop verbatim.

## Security decisions (read before touching auth)

- **The adopt form collects NO secret, and must not be given one back.**
  The captain's passwordless decision superseded the earlier PIN plan and ordered the field, the `pinHash` column and the username+PIN screen dropped.
  His three reasons, each of which a secret here undoes: a forgotten one is permanent lockout with no recovery path; a cloned plaque on a public repo is a reusable secret to harvest; and a short numeric code on a street object has no brute-force protection.
  He also preferred a tap-to-sign-in LINK over a typed code, because a typed code is relay-phishable.
  A steward's public handle is derived from their name instead (`deriveUsername` in `service.ts`) — Marisol Rivera → `@marisol_r`, the shape the seed already had.
- **What carries a steward today is the session cookie, which lasts a year.**
  Sign-in is rare precisely because of that, which is why adopting without a way back in is survivable rather than broken.
  **Known gap, stated rather than buried: a steward who clears cookies before the tap-to-sign-in link lands has no return path.**
  Building that link needs the org's Brevo account and belongs to `adopt-name-split-r5`.
- **The `/auth` PIN screens are pre-existing and deliberately left in place.**
  Nobody the new adopt form creates can use them — `pinHash` is null and `hasSignInRoute` is false, so `signIn` gives them the unmatchable hash — and migrating those screens is that same later task.
  A 4–8 digit PIN is brute-forceable and there is still no rate limiting on sign-in attempts.
  Do not build new flows on them.
- Where a PIN still exists (the pre-existing `/auth` screens and the seeded steward), it is bcrypt-hashed (`hashPin`/`verifyPin` in service.ts). Never store, log, or echo a plaintext PIN.
  The adopt form has no field to re-fill: it collects no secret, so everything the visitor typed comes back on a validation error.
- **`MAX_INFLIGHT_PIN_HASHES` (service.ts, 4) bounds the backlog a PIN hash can build, not how many PINs may be tried and not the CPU itself.**
  It covers `/auth` only. `/adopt` used to hash too; passwordless removed that, so the only work a flood can buy there is the bed's offered slots, at a few reads each.
  `request-body.ts` bounds bytes, time and concurrency for every public POST, but it releases a read's share of `MAX_INFLIGHT_BODY_BYTES` before any rule runs, and a bcrypt is ~150–300ms of the one thread that also serves every tap.
  So `/auth` is the one place an anonymous caller can still queue unbounded work: a few dozen POSTs a second saturate the loop and every tap, report and applause stalls behind however many hashes the flood managed to start.
  Past the bound the request is shed rather than queued — waiting in line for a saturated CPU is the stall, not the cure — and `signIn` takes its slot *before* the username lookup, so being shed can't reveal what the constant-time compare below is there to hide.
  What that buys is bounded queue depth and bounded added latency, not a bounded share of the CPU: bcryptjs yields to the event loop once per 100ms of synchronous work (`MAX_EXECUTION_TIME`), not per round, so four admitted hashes still keep the thread in bcrypt nearly continuously. A tap arriving mid-flood waits behind at most four hashes — a few hundred milliseconds — instead of behind an unbounded queue. The door screen, the report and the applause stay usable under load; they do not stay fast.
  The other side of that trade, deliberately: a sustained anonymous flood holds sign-in at its busy screen for as long as it lasts. Auth loses to the tap/report path, which is the whole reason the bound sheds. Per-IP limiting at the platform tier is the eventual remedy, alongside the per-PIN and per-account rate limiting that is still absent and still owed before any real rollout — this bounds the cost of attempts, not their number.
  The sign-in screen answers it itself: the form comes back with a 503, `retry-after`, and the username still in it — never the PIN, which no response carries back. Shedding logs at most one line a minute, carrying the number shed since the last one: the node adapter writes no access log, so 503s are otherwise invisible from the box, but a line per refusal would let an anonymous flood decide how much stderr it costs us — the same reason `request-body.ts` says nothing at all for a `busy` refusal.
  How many hashes overlap depends on how fast the box is, so the end-to-end proof of what a shed visitor receives runs against a server started with `TREEBED_MAX_INFLIGHT_PIN_HASHES=0` — a test seam like the two in `request-body.ts`, not a deployment knob. Zero stays legal for exactly that reason, and it is announced the same way the session secret is: `scripts/preflight.mjs` warns before the port is bound under `npm start` / `npm run preview`, and `warnIfPinHashingDisabled` (called from `src/middleware.ts`) covers a server started any other way.
  That second one is *not* a boot warning and neither is the session-secret assertion beside it — measured against the built bundle, the node adapter imports the middleware lazily (`middleware: () => import("./virtual_astro_middleware.mjs")`), so both speak on the first request of any route. Nothing inside the app can speak earlier; preflight is the only code that runs before the server listens.
- `signIn` runs a bcrypt compare even when the username is unknown, so unknown-user and wrong-PIN cost the same.
  Don't "optimize" that short circuit back in — without rate limiting it is the only thing making username enumeration expensive.
  A steward with no sign-in route gets the same unmatchable hash, so "no such person" and "cannot sign in" are not distinguishable by timing either.
  `adoptBed` no longer has that question to leak: nobody submits a handle, so there is no "that username is taken" to answer and no oracle to price. What sheds a flood there is the bed and the slots — once both are taken, every further POST refuses on three reads.
- `TREEBED_SESSION_SECRET` is required in production; the app refuses to sign cookies with a generated one. The `.data/session-secret` fallback is dev-only.
  The requirement is checked twice so a misconfigured deploy can't reach traffic: `scripts/preflight.mjs` runs as npm's `prestart` and `prepreview` and refuses to boot, and `src/middleware.ts` asserts at module load so a server started any other way fails on its first request of any route rather than on the first one that touches a cookie.
- **Every public POST reads its body through `src/lib/request-body.ts`, never `request.formData()` directly** — the adapter's own default limit is 1GB of buffered memory.
  The comment block at the top of that file is the whole-surface sweep — size, time, concurrency, peak heap, and what the caller sees for every publicly reachable route — and a new route belongs in it.
  Four bounds, because three rounds of review each found one of them missing somewhere: a byte cap per body, a time bound on *both* the accepted and the refused read, an in-flight byte budget across all reads at once, and the drain headroom below.
  A route bounds only the method it exports, so `src/middleware.ts` drains once after `next()` settles as the backstop for every route and every method — a no-op wherever the body was already read, and what covers the `PUT` at `/report` no route handler ever sees.
  It drains in a `finally`, so a route that throws is covered too: Astro turns the rejection into a 500 of its own, and the unread body has to be accounted for before that answer is written.
  The three POST endpoints export `ALL = postOnly` (`tag-route.ts`) so an unhandled method is answered 405 rather than by Astro's own 404, which logs a line per request and would let an anonymous caller decide how much stderr it costs us.
  One refusal is deliberately not ours: Astro's cross-origin guard runs ahead of our middleware and answers a form-content-type POST with a missing or mismatched `Origin` header 403 with the body unread.
  Taking that over would mean turning off `security.checkOrigin` and re-implementing CSRF ourselves to recover work spent on requests that were going to be refused anyway — accepted and recorded in the sweep comment instead.
- **The photo cap is per target: 12MB on node, 4MB on netlify.**
  Netlify caps a synchronous function's request payload at 6MB and buffers the body before the function is invoked, so a larger upload never reaches the route: the platform answers a bare 413 and `too-large.astro` — whose whole point is handing the visitor back the report they already filled in — never renders.
  Set below the platform's own limit, every refusal a visitor can provoke is one this route makes gracefully.
  The streaming bounds below are measured against the node adapter's real sockets either way; on netlify the body has already been buffered by the platform by the time we read it, so what they buy there is the graceful screen, not the heap.
  Every bound in this section, and `MAX_INFLIGHT_PIN_HASHES` above, is a module-level counter, so it bounds one process: the whole server on the node target (what `npm start` runs and what the e2e suite measures), one function instance on netlify.
  Fleet-wide peak heap and bcrypt concurrency there are these numbers times however many instances the platform is running, and a single warm instance serving concurrent invocations sheds legitimate sign-ins at the hash limit exactly as it sheds a flood.
  They are per-instance costs, not the pilot's surface-wide DoS ceiling — bounding the surface is the per-IP limiting at the platform tier already noted as owed.
- The report route never buffers the photo. `readCappedHead` counts the bytes and keeps only the first `HEAD_BYTES`, which is where the categories, the note and the filename are, so a 12MB upload costs kilobytes instead of the 24–36MB that buffering plus `formData()` cost (~30MB measured per upload).
  `textFieldFromHead` is what reads them, which only works while the care screen's markup keeps its text parts ahead of the file input — browsers send parts in DOM order. Keep it that way if the screen gains a field; `tests/care-form-order.e2e.test.ts` pins it by reading the order off the rendered care screen and posting a body built in it, so a reordered field fails the suite rather than the street.
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
- Each refusal is its own answer: on `/report` every one of them reaches the too-large screen with every category picked and the note preserved, because the head holds them whichever way the upload ended and what the visitor told us is what is being rescued — the one exception being a read past `MAX_SHED_READS`, which keeps no head, so its screen offers the picker again instead of the one-tap resend.
  `?reason` picks the words — nothing (a photo to shrink), `busy` (a queue to retry), `incomplete` (an upload that stopped halfway, which is *not* to be blamed on a photo that may have been well under the cap).
  The text-only forms answer in plain text instead (413/408/503/400) because there is no filled-in report behind them to preserve.
  Those plain-text refusals are the one visitor-reachable surface that is English-only; they are the transport saying no before any screen exists to say it in, and a body that never arrived carries no language preference either.
  A read that *fails* is not an oversized body, and an oversized body whose sender then hangs up is not a failed read — that one keeps `'over-limit'` and logs one quiet line, because a visitor closing the tab on a refused upload is not an incident.
- Tap counting must be wrong in neither direction, and `src/lib/plaque-url.ts` is the one place that decides it.
  Every POST route that sends someone back to the door screen and every link back to it from one of our own screens builds the URL with `ourPlaqueLink` — one function, because it answers one question — and the door screen suppresses its tap event only for the flags in `POST_ACTION_FLAGS`.
  Suppressing on "the URL has a query string" would drop every tap from a decorated tag URL (UTM, Popl, a link shortener); matching only the flags that flash something counted one visit twice every time a rule sent a visitor back with nothing to say.
  A link back counts as ours for the same reason a redirect does — somebody already on the thank-you takeover or the sign-in form had their tap counted when they arrived — and it is the commonest flow of all: tap, send, read the thank-you, press "back to the bed".
  `?lang=` is deliberately NOT one of the suppressing flags: any decorated tag URL could carry it, and a flag that stops counting is one a link shortener could set by accident. Switching language on the door screen itself therefore renders a second view of one visit — one person at one tree either way, and the cheaper mistake of the two.
  The site root redirects through `ourPlaqueLink` too: a tag never sends anyone to `/`, so what does is an uptime check, a crawler, or somebody typing the domain, and a monitor polling it once a minute would be 1,440 taps a day on the demo bed it is pinned to (`DEMO_TAG_ID`).
  It also counts only a `GET`: Astro renders the door screen for any method, but a tap is a person opening the URL on the chip, and a hand-built POST or PUT — or a monitor's HEAD — is nobody standing at a tree bed.
  Known residual, accepted rather than fixed: because the flag rides the URL, a visitor who uses an in-app back-link is left with `?tg_action=1` in the address bar, so a later return through history, a bookmark or a shared link renders the door screen without logging a tap — a small under-count in the opposite direction. The NFC tag always sends the bare URL, so the primary metric path is unaffected, and the alternatives (a Referer check, a short-lived nav cookie) are each less reliable and less legible than one flag in one place.
- Email and phone are PII: stored on the user record, never rendered on any public screen, never included in any client-visible payload.
  Only the username and the initials are engraved, and only while `displayNameHidden` is false.

## Identity, privacy and consent

- **Public screens key off NYC Parks' planting space ID, shown as `#<id>` (`Bed.plantingSpaceId`).**
  The bed rather than the tree, deliberately: planting spaces persist while trees churn through retirement and stumps, so an adoption keyed to the bed survives a replanting.
  Our own plate encodes site type and neighbourhood and is **never rendered** — it survives as the join key every report, adoption and event hangs on.
  The opaque tag ID stays the URL and an internal key, and is displayed on exactly one screen: the calm "not assigned to a bed yet" one, where it is the only thing there is to say.
  A bed NYC has no number for prints no number at all rather than falling back to the plate.
- **The FIRST steward names the bed, and the name is the BED's, not theirs** (`Bed.bedName`, nullable).
  The captain's own words: "the first adopter names the bed".
  `adopt.astro` offers the optional field only while the bed has no steward and no name, and `adoptBed` re-decides that inside its transaction against the adoptions it is committing against — anyone else's `bedName` is silently DROPPED and their adoption still goes through, because nobody standing at a tree is shown a rule.
  Releasing or removing the steward who chose it changes nothing; only the block admin can take a name back to null, and a bed returned to unnamed may be named again by a later first steward.
  There is no rename path and the admin never types one.
  The name is **visitor free text rendered as typed in BOTH languages** — a name is not translated — so it is always its own leaf beside the bed's identity (both doors, plus `mine.astro`), never spliced into a bilingual sentence, and it is set in Londrina Solid because this is a plaque, not a form field.
  An unnamed bed renders no element at all.
- **A steward is shown as username first, then initials — `@marisol_r`, `M. R.`** (`publicHandle` / `publicInitials` in `types.ts`).
  The handle is DERIVED from the name, not typed: the approved form has no username field, and `deriveUsername` gives the first name plus the last initial — exactly as much as the initials printed under it already give away.
  Full name, email and phone are admin-only and must never reach a public screen or payload.
  `fullName` exists for the admin surface and has no caller in the visitor flow.
- **The word is "steward", not "adopter", throughout** — copy, types, comments and test names alike.
- **Do not render a privacy policy link.**
  There is no policy yet, and a dead link on a form collecting an email and a phone number is worse than none (design-record.md, answered open question 1).
  `ADOPT.privacy` is the plain sentence, and `adopt.astro` marks the single obvious place the link goes when there is one.
- **Do not render the mailing-list signup line either, for the same reason.**
  There is no real signup URL, and the approved takeover's `trashtalknyc.org/xxx` was a placeholder shown to every visitor at the end of the core street action.
  It is removed rather than guessed at; `thanks.astro` marks the one place it goes back, and putting it back needs one real URL on `Presentation.copy` plus its sentence in `copy.ts`.
- **A steward may be held without an email**, because the sidewalk case needs it (answered open question 3).
  `User.hasSignInRoute` and `User.recordHeldOnBehalf` record that explicitly, and `pinHash` is nullable; `signIn` gives such a user the unmatchable hash so the refusal costs the same bcrypt as any other.
  The two flags are distinct on purpose: a steward who adopts at the tag today also has `hasSignInRoute: false` (there is no secret and no link yet), but `recordHeldOnBehalf: false` — they signed themselves up and gave an email, and nobody is holding the record for them.
  **Do not invent an outreach mechanism, and never read a missing email as consent to be contacted.**
  The admin flow that creates these is a later task.
- **The NYC sync is read-only and additive.**
  `Bed.nycMissingSince` is a flag for a human and nothing else: a bed that disappears from NYC's data is never deleted, unpublished or orphaned, and its adoption is never touched.
  The captain was asked and answered "we don't know" (answered open question 2), so the build takes the one action that cannot destroy a live adoption.
  Whoever implements the sync: do not turn that flag into a cascade.
  `normalizeData` in `store-dataset.ts` is held to the same rule — it fills in fields a stored record predates, additively and losslessly, because the pilot store is live, seeding only runs on first contact, and there is deliberately no migration step.

## Design tokens

- The palette is the identity the captain approved across the tap-flow review (`design-record.md`, constraint 2), and it lives in `src/lib/presentation.ts` — **not** in `src/styles/global.css`, which names no colour at all.
  See "Presentation is data-driven" above.
  Poster Beige `#eae9da` · Post No Bills Green `#4e6e65` · Deep Purple `#65409a` · Street Sign Yellow `#f3cf02` · Roadtop Black `#1d1d23`, with roles: purple = the positive ownership action, yellow = attention (**always with black on it, never white — white on yellow is 1.53:1**), green = all-clear/adopted and the ground door 2 stands on, beige = the page ground — which is door 1's ground — and the buttons placed on the green.
  Four values are one step off the review mock because the mock's own value does not clear WCAG AA; each moved the minimum distance and no hue changed.
  `tests/presentation.test.ts` holds every pair to it.
- Type is two families and nothing else (constraint 3): **Londrina Solid** on headlines, the plate and buttons; **Barlow** on everything else.
  Barlow labels are sentence case, not all-caps — only the buttons and the two kicker rules shout.
  Self-hosted subsets; provenance and the character set are pinned in `public/fonts/README.md`.
  No Google Fonts CDN.
  The accented range is load-bearing: every screen exists in Spanish.
  Bebas Neue is intentionally absent — the approved screens don't use it despite spec §3a.
- **Safe areas are armed in one place and used in one place.** `viewport-fit=cover` in `Screen.astro`'s viewport meta is what makes `env(safe-area-inset-*)` resolve to anything but zero; without that line every `calc()` in `.screen` silently collapses to its fallback.
  The insets are ADDED to the design's own padding, never substituted for it.
  This project has an expensive history of header/safe-area bugs shipped from unverified theories — verify on a physical device, not a simulator, and do not "fix" anything here speculatively.
- The problem-picker tiles use a **risograph treatment**: one flat spot ink per choice (`currentColor`, so the ink is a theme role), knocked off register and multiplied into the paper, under a fixed noise plate.
  Carried over from the approved screens rather than re-invented.
- The oversized action buttons (`.btn-tall`) are the captain's explicit override — a thumb, at arm's length, in the rain.
  Don't shrink them back.
- **"Adopted!" and "Thank you" are full-screen takeovers, with animation to follow.** The seam for it is `.takeover-mark`, an element that exists only to be animated; `prefers-reduced-motion` is already honoured in `global.css` so the first animation added inherits the guard.
  **Do not build the animation.**
- `t/[tag]/too-large.astro` is the one screen with no counterpart in the approved screens: where a refused upload lands.
  Telling us a bed needs care is the core street action, so an optional attachment must never cost somebody what they already told us — the screen carries their category and their sentence back and offers to send it without the photo.
  `?reason=busy` and `?reason=incomplete` are the same screen with their own words, because nothing is gained by telling somebody to shrink a photo that was never the problem.

## Scope deliberately left out (later tasks)

- Supabase/Postgres/PostGIS, R2, any hosted service — the store swap is designed for this.
- Photo storage (the care sheet's attach affordance records only `photoAttached`), points/streak earning rules, the 1-day grace period, 311 handoff, NFC tag cryptographic verification, provisioning flow.
- **Group theming.** `presentation.ts` is shaped for it and must not grow it — `Block` (types.ts) is an admin grouping, deliberately NOT the theming seam.
- **Pen-and-paper steward outreach.** `User.recordHeldOnBehalf` marks who to reach when a contact route exists; nothing contacts anyone, and a missing email is never consent to be contacted.
- The block-over-time view, deliberately pulled from the visitor flow and kept admin-only.
- The NYC Open Data sync itself.
  `Bed.nycSyncedAt` / `nycMissingSince` are the fields it will write.
- Points on the steward's own view render the stored value only; nothing increments it yet.
  The weekly-photo ask is REMOVED from that screen (captain, 2026-09-11): no photo button, no photo-streak stat, no `/photo` route.
  `User.streakWeeks` and the `photo` event kind stay in the model as stored history — the ask left the screen, the record was not deleted.
  The care report's optional photo attachment is a different feature and is untouched.

## The block admin (/admin)

The captain's own surface — the one place full names, emails and phones render — built to `data/block-admin-w171/approved-screens.html` (desktop two-pane and the phone flow are ONE route, `src/pages/admin/blocks/[block]/index.astro`, switched by `?bed=`/`?steward=` params and a media query, so every state is a link and it all works with no script).
`/admin` itself is the key screen and, behind the session, the block list — real blocks before `demo` ones.
`add-steward.astro` and `add-bed.astro` sit beside the block page as the two forms that need a page of their own.

- **Gate: `TREEBED_ADMIN_KEY`** (session.ts). Where no key is configured, every /admin route answers 404 — a deploy that never configured one has no admin, deliberately; the pilot site has held a key site-level since 2026-09-10, so its /admin is live. Dev generates one into `.data/admin-key`. The signed `tg_admin` cookie lasts 30 days. This is deliberately NOT a username+PIN: the /auth screens are the dead end nothing builds on, and a long random key costs no bcrypt and offers no enumeration. Per-IP throttling is still the platform-tier debt recorded in request-body.ts.
- **`Bed.offeredSlots` is a rule, not a display state**: `adoptBed` refuses past `min(slots, offeredSlots)`, and `BedView.openSlots` is derived from that same bound — the door screen and `adopt.astro` gate the invitation on it, so an unoffered bed shows no adopt button and no form the rules would then have to refuse. The six W 171st beds seed with `offeredSlots: 0` — opening one is the captain's act, on this page.
  The switches submit slot NUMBERS, not a count: `offeredSlots` covers slots 1..n, so a gapped selection is refused (bilingual, 422, switches re-rendered as submitted) rather than saved as its size, which would flip a switch nobody touched.
- **The bed-name row is a takedown, not an edit.** It renders in the opened bed's panel only when the bed HAS a name, and the switch removes it on SAVE CHANGES (`BlockSaveInput.bed.clearBedName` → `bedName: null`), touching neither the bed nor its adoption. Visitor free text on a screen bolted to a street needs a way down; the admin never authors a name, and the only way one comes back is a later first steward naming the bed again.
- **`POST /admin/sign-out` closes the session**, and the control sits in the admin bar on every admin screen (`AdminScreen.astro`) — the 30-day `tg_admin` cookie opens PII on a phone that gets handed around, and the alternatives were clearing site data or rotating the key for everyone.
- **The bed profile is per-bed data the admin keeps and the public "About this bed" page states** (`/t/<tag>/about`, reached by a small text link under BOTH doors' buttons — never a third big button).
  `Bed.guard` is one three-way field (`none`/`wood`/`metal`) — never a flag plus a material — and replaced the earlier ordered/installed date pair; older stored rows keep those dates untouched.
  It is also nullable, and null means NOT YET RECORDED: every seeded bed, every backfilled row and every bed the admin adds starts there, never at `none`, because the demo bed's tag rides a guard the old record never described and the W 171st tags go in with their guards.
  The About page omits the guard row entirely while unset and the admin panel marks it not set until the admin picks one.
  **`treePresent`, `plantsPresent` and `plantingRecommended` follow that same rule and are `boolean | null` for it**: three-way radios in the panel, null is NOT YET RECORDED, every seed and backfill starts there rather than at `false`, and the About page omits the statement until somebody has said — a default is not somebody having looked.
  Each of them is a radio rather than a switch because a checkbox cannot tell "unchecked" from "not sent"; the species is still named on the About page whatever the fact reads, because it is what the bed is FOR and both doors headline it.
  **Each of those four rows carries its own NOT RECORDED radio (`UNRECORDED_CHOICE`), which is the only way a fact goes back to unrecorded.**
  The absence of a radio cannot be that control — the captain records these one-handed on a sidewalk and a mis-tap must be undoable, while a form carrying no radio is a stale page or a hand-built POST — so the parse helpers (`guardMaterialFrom` / `bedFactFrom`) answer three ways: a value, null for the choice, and undefined for keep-as-it-stands, which `saveBlockSettings` distinguishes with `=== undefined` rather than `??`.
  One rule covers the whole profile: a field the form did not carry keeps what stands, notes included, so a partial POST blanks nothing.
  `plantsNote` and `recommendedPlantsNote` render only while their fact reads yes, and the save never blanks them, so answering "no" and back again restores the words.
  `plantsNote`/`recommendedPlantsNote`/`careNote` are admin-typed free text, bounded by `MAX_BED_NOTE_CHARS`, rendered AS TYPED in both languages (own leaf, no `data-en`/`data-es`) like `bedName`.
  The FAQ under the profile is network-wide copy (`ABOUT_FAQ` in copy.ts) so the captain edits sentences, not screens.
- **The bed panel states the bed's open report, read-only** (`AdminBedView.openReport`, the same record `mine.astro` reads): what was picked, the note, when it was opened, the `confirmedBy` count, and — under "Neighbours also said", from `AdminBedView.openReportConfirms` — what each confirming neighbour picked and typed, the same `confirm` events joined by `reportId` that the steward reads.
  It exists so the FAQ's "Trash Talk NYC sees the report" is true of a screen rather than of a CLI, which is also why the captain's surface must never see less of a report than the steward does; nothing on it writes, and closing a report stays the steward's act behind `/clear`.
  Both notes go through `capped` AT RENDER here as well as at the write, because the live pilot store already holds a note written before write-time sanitising reached the visitor's note.
- **Deleting a bed is RETIRING it (`retireBedByAdmin`, `Bed.retiredAt`), never erasing the row** — the plate is the join key its history hangs on, and `ensureCheckedInBlocks` would re-insert an erased seeded bed on the next load, so only the tombstone stays deleted.
  A retired bed drops off the street list, every rule and screen answers not-found for its plate (service.ts `getActiveBed`), a still-bound tag renders the calm "not assigned" screen without the registry-typo stderr line, and the plate and position are never reused.
  The delete is two deliberate taps: the panel's link only opens `delete-bed.astro`, whose own POST does it. One bed at a time — no bulk delete, on purpose.
  **The way back is `restoreBedByAdmin`**, reached from a "Deleted beds" section below the street list on the block page — `BlockView.retired` is what the page draws it from, and a retired row offers RESTORE and nothing else (no panel, no bulk act).
  It exists because the tag→site registry is checked in with no runtime write path, so without it a mis-tap on the live pilot would cost that tag its screen until somebody shipped a commit.
  Restoring clears `retiredAt` and touches nothing else, so the bed comes back exactly as it was. It is deliberately NOT a trash view: no retention policy, no auto-purge, no permanent delete.
- `addStewardByAdmin` is the sidewalk case: email optional, `hasSignInRoute: false`, `recordHeldOnBehalf: true`, adoption `stewardKind: 'pen-and-paper'`. It may fill an unoffered slot (writing a neighbour in is the point) but never past `slots`. A typed username that collides is refused, not mutated.
- **NYC identifiers are resolved or null, never invented.** The six beds' `plantingSpaceId`/`plantingSpaceGlobalId`/`treeId` were resolved against NYC's Forestry Planting Spaces (`82zj-84is`) and Tree Points (`hn5i-inap`) — method and citations sit on `w171Beds()` in store-dataset.ts. `addBedByAdmin` creates beds with null NYC fields and the panel prints the unresolved marker; keep it that way.
- Admin styles are `src/styles/admin.css` — same law as global.css: no hex anywhere, tints via `color-mix` on the `--theme-*` roles, so the presentation tests still hold the whole surface.
- The admin is bilingual like everything else (`ADMIN` in copy.ts); tests/i18n.test.ts names the only four identical-in-both entries (PIN, ADMIN, DEMO, NFC) and fails any new one.

## Seed data

**The captain's real block seeds and BACKFILLS: `w-171-fort-washington-haven`, reference address 708 W 171st — six real beds `BED-WH-1711`…`1716` (five willow oaks with guards ordered in the real world; one white oak at position 5, no guard coming), each bound to its real NYC planting space and each seeding `guard: null` — not yet recorded, never `none`, because the tags go in with the guards.**
`ensureCheckedInBlocks` (store-dataset.ts) runs inside `normalizeData`, so an already-seeded store — the LIVE pilot store included — gains the blocks and beds on its next load, insert-only by key: nothing the captain edits on the admin page is ever overwritten by a later load. That is how new checked-in records reach live data without a migration step; follow the same shape for the next block.

One hand-seeded DEMO bed `BED-HRL-0847` — planting space `#15850293`, which is a mockup number matching NO real NYC record (checked 2026-09-10), a willow oak — with seeded steward `marisol_r` (Marisol Rivera, shown publicly as `@marisol_r` / `M. R.`).
It deliberately lives in its own `demo`-flagged block (`w-138-acp-demo`), never in the captain's, so the admin can reach its live pilot history without a fake bed reading as part of a real street.
On the local store it is created on first boot with PIN `1234` — demo credentials for driving the sign-in flow locally.
The checked-in registry (`src/lib/tag-bindings.ts`) binds demo tag `2mq2amhv` to that bed, so `/t/2mq2amhv` renders on first run; the e2e suite and the site-root redirect both key off that binding.
It is not the only binding — four of the captain's real W 171st beds (`BED-WH-1711`…`1714`) carry real tags there too, so read `tag-bindings.ts` rather than assuming a single demo row.
The site root redirects to the demo binding **by name** (`DEMO_TAG_ID`), never to whichever row sits first, and answers 500 if that binding is gone: root traffic is monitors, crawlers and typed domains, and a real bed's tap count must not absorb it.

**`BlobsStore` seeds the same steward with no PIN anybody knows** (a hash of random bytes), because that store is the publicly tappable one: the door screen engraves `@marisol_r`, sign-in has no rate limiting yet, and a well-known PIN there would be an open steward account on the internet — `/mine` and the deliberately auth-gated `/clear`.
`TREEBED_SEED_PIN` is a **development-only** seam, for driving the sign-in flow against a store that seeds without one.
It is unset on the Netlify site and must never be set there: a PIN supplied to the publicly tappable store is the open steward account this seed exists to avoid.
That is enforced in code rather than by this paragraph — `seed()` reads the variable only on the node target (`BUILD_TARGET`, the same shape as the store-selection assertion), so a production build ignores it however it is set.

The pilot store was seeded *before* this change — seeding only ever runs on first contact — so it held the `1234` hash.
**That is remediated: `marisol_r`'s `pinHash` was rotated in place** by appending a revision copying the newest one with the hash replaced by a bcrypt of discarded random bytes.
Signing in with `1234` on the live site now fails, and the pilot's data (report, events, adoption) came through intact.
Rotating a hash forward is the procedure to repeat if it is ever needed again — do not wipe the store to re-seed it.
`scripts/rewrite-species-casing.mjs` is that same forward-revision shape, written down: it lowercases a `treeType.es` a store was seeded with before the door frame's casing rule, and only where the stored value is the checked-in table's own value modulo casing, so a human's Spanish name is never rewritten.
It is a deliberate act a human runs (dry run by default, `--commit` to write) and never `normalizeData` behaviour — that stays additive-only, so nothing on the read path ever corrects a field a stored record already has.
It needs `NETLIFY_SITE_ID` and `NETLIFY_AUTH_TOKEN` — `@netlify/blobs` reads neither on its own — and refuses up front without them, and it needs Node >= 22.18 because it imports `.ts` modules directly.
That last one is why it is two files: the entry checks the Node version and the credentials before anything imports a `.ts` module, and the rewrite rule itself lives in `scripts/species-casing-rewrite.mjs` where the tests reach it.
The store's name and key layout come from `src/lib/store-keys.ts` (re-exported by `store-blobs.ts`), so a remediation script can never drift onto the wrong keys.
Follow its shape for the next field a live store has to be corrected on.

If a store genuinely has to be re-seeded, **delete the `head` key alongside the `rev/*` keys.**
A surviving `head` is the store's own proof that it has been written to, and `BlobsStore` refuses to seed once it has read one — deliberately, because a key listing is eventually consistent and a stale-empty one would otherwise fork a fresh chain over live data.

## Deployment (pilot)

- Production is the Netlify site **`treebed-plaque`** (site id `449a9585-ae51-4e23-9614-fe5b3ac669f1`), live at <https://treebed-plaque.netlify.app>, resolved for wayfinder ticket #8.
  **The site `trashtalknyc` (id `77ee72e0-18f8-43b7-a338-9b5d67d40236`) is the org's public website — a different product. Never deploy this app there.**
- Deploys are CLI-driven, not repo-linked: `NETLIFY_SITE_ID=449a9585-ae51-4e23-9614-fe5b3ac669f1 npx netlify-cli@latest deploy --build --prod` from a checkout on Node >= 22.
  `netlify.toml` carries the build command, the publish dir, and the environment that selects the netlify adapter — the CLI applies it, so no flags beyond the site id are needed.
- **The environment is split by when it is read, and each key lives in exactly one place.**
  `netlify.toml`'s `[build.environment]` is the sole source for the build-time keys — `TREEBED_ADAPTER=netlify`, `NODE_VERSION=22`, and `AWS_LAMBDA_JS_RUNTIME=nodejs22.x` (functions default to an older Node than `engines` demands, and that failure shows up at request time rather than at build time) — so a recreated or duplicated site builds and runs correctly without anyone remembering an `env:set`.
  Site-level environment carries only the runtime keys: `TREEBED_SESSION_SECRET` (secret, generated — never in the repo) and `TREEBED_STORE=blobs`.
  `TREEBED_ADMIN_KEY` is the third runtime key and is set there on the pilot as of 2026-09-10 — never in `netlify.toml`, which is checked in, so a key there would be a published one; where no key is set every `/admin` route on a deployed site answers 404.
  **None of the three build-time keys is to be set with `netlify env:set`**: a site-level variable silently overrides `[build.environment]`, so a duplicate would leave this file documented as the source of truth while the site quietly won, and an edit here would have no effect on the deploy.
  The earlier site-level copies of all three have been unset accordingly.
  Checking that is itself a trap: `netlify env:list` run *inside the repo* merges `[build.environment]` into its output, so the build-time keys appear whether or not the site holds them — site-only state has to be checked from outside a checkout.
- The custom domain (`trashtalknyc.org/t/*` proxying, per ticket #5) is deliberately not wired yet; the `/b/[plate]` → `/t/[tag]` re-key landed separately and is what the site already serves.

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

Leaving the chain advisory is a **deliberate accepted risk** taken by the captain (small team, and no branch deploys itself — the pilot ships by CLI from a checkout), not an oversight.
If the repo ever goes public or the org upgrades to a paid plan, replace this check with real branch protection / rulesets and mark it a required status check.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
