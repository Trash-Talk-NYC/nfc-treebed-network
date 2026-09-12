# NFC Tree Bed Network — agent notes

The post-tap experience for Trash Talk NYC's NFC tree bed network.
A pedestrian taps a tag on a tree guard and lands on `/t/<tag>` — an opaque 8-character tag ID, e.g. `/t/2mq2amhv`, or one of the captain's named bed ids, e.g. `/t/1nhfw171` (production host `https://trashtalknyc.org/t/<id>`; the custom domain is separate work).
The bed's plate (`BED-HRL-0847`) is an INTERNAL join key and no screen ever renders one; on the named-run beds the plate happens to BE the captain's bed id (its lowercase is the URL, his 2026-09-12 decision), so those plates are no secret, but the render rule is unchanged — see "The tag URL" and "The two doors" below.

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
An unoffered bed is a normal state — four of the six W 171st beds seed that way — not a bed to be "fixed" by restoring the button the rules would then refuse.

**Both doors — and every other tap-flow screen — stand on solid Post No Bills Green with Poster Beige as the secondary.**
This is the captain's 2026-09-11 reversal of his earlier decision that put door 1 on Poster Beige, so do not restore the beige door: the beige is now the secondary — the ink and body text over the green, the button pair (`btn-on-clear` beige fill / `btn-on-clear-outline`), and the paper the containers and picker tiles stand on (`--theme-ground` is still the beige for exactly that reason, and for the admin, which keeps the old beige look untouched).
Door 1's headline still carries no highlight, so it reads as one plain sentence; door 2 keeps the tree type picked out in beige (`.hl`) — that asymmetry survived the reversal, and `tests/steward-privacy.e2e.test.ts` asserts the green ground, the shared button pair and door 1's absent highlight in both languages.
Yellow survives only as the attention role on fills that carry black — the report band and the green-ground error chip — never as a button.
A signed-in steward also gets the bookmark cue at the bottom of door 2 (and every new steward gets it on the "Adopted!" takeover): the bed's own `/t/<tag>` URL, the way back without tapping the tag.

`THIS BED NEEDS CARE` opens the problem picker (`care.astro`): thirsty plants / litter / guard damage / something else, plus an optional photo — STORED since the captain's 2026-09-12 "store the photos and show them in admin" (see "The block admin" below; the earlier discard-only behaviour is superseded).
The picker is MULTI-select — the tiles are checkboxes and a report carries `categories`, a non-empty list in tile order (a bed that is thirsty AND full of litter is one report); an empty submission is the server's refusal, back to the picker with the bilingual pick-one line, because checkboxes have no `required` that means "at least one".
"Something else" is a GET submit of the same form back to `?tell=1`, which is the same route rendering the free-text box — a form GET rather than a link or a script, so the second screen exists with JavaScript disabled AND the tiles already pressed ride its query string (a link's href cannot know what is checked); the sentence screen sends them back out as hidden fields beside `other`, and a hidden `lang` field carries the language because a GET replaces its action's query string.
Both send to `report.ts`, which lands on the full-screen "Thank you" (`thanks.astro`).
Under both doors' buttons sits one small text link to "About this bed" (`/t/<tag>/about`) — the bed's profile and the network FAQ, never a third big button; see "The block admin" for the data behind it.
Adoption lands on the full-screen "Adopted!" (`adopted.astro`), on the same green ground as everything else since the reversal.

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
- A bed's species can be NOT YET RECORDED (`Bed.treeType: null` — the 20 fresh captain-run beds seed that way): the door frames then take the generic tree and stay whole sentences in both languages — "This tree's bed is looking for a steward." / "El cantero de este árbol busca quien lo cuide." (`speciesShown`, format.ts) — while the About page, where the species is an assertion rather than a frame, states "not recorded" (`ABOUT.treeUnknown`). Never a guessed species, never a broken sentence.
- A bed's Spanish species name defaults from the checked-in table in `src/lib/tree-species.ts` when a bed is added: an explicitly typed Spanish name wins, and an unknown species degrades to the generic "árbol" — never a guess, a transliteration, or a runtime translation.
  Casing comes from the TABLE or from the TYPIST, never from a forced transform: `tree-species.ts` authors each species' name in both languages the way it should read MID-SENTENCE in that frame — "willow oak" but "Norway maple", "Japanese tree lilac", "London planetree", because English common names carry proper adjectives where Spanish ones ("arce noruego") do not — and `resolveSpecies` stores the table's spelling for a species it knows and the typed one byte-for-byte for a species it does not.
  Nothing lowercases a species at render: `speciesShown` prints what is stored, so a capital there is one somebody meant.
  The screens that print the species STANDALONE — the steward's own heading and the admin bed labels — capitalize at the render site with `capitalizeFirst` (`format.ts`), never with CSS and never by changing what is stored.
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
  That script builds the netlify target *and* runs `scripts/smoke-netlify.mjs`, then `scripts/smoke-digest-function.mjs`, which bundles `netlify/functions/digest.mts` with esbuild the way Netlify does and imports the result — nothing else in CI builds or loads that file, and a broken import there would surface only as a scheduled run that silently did nothing. It loads the module and never invokes the handler: no store, no send.
  The SSR smoke imports the emitted `.netlify/v1/functions/ssr/ssr.mjs` and renders requests through it: the break this repo actually hit (`app.getLogger()`) is a load-time crash that a build alone passes green, so the build without the boot would prove only that the adapter resolves and the bundle emits.
  It drives two requests that need no Blobs backend: an invalid tag ID, answered 404 in plain text before any store read, and the root, which consults the store but is built to fall to its calm screen rather than fail when it cannot — so the rendered answer arrives either way.
- The tap flow ships two small inline scripts and nothing else: the language toggle's instant swap (`Screen.astro`) and the care screen's photo-attached state plus note counter (`care.astro`).
  Both are enhancements. Every form is a plain HTML POST (plus the care picker's one GET submit, above), the language toggle is a pair of plain links — a two-state control showing both languages with the active one marked `aria-current`, per the captain's ask (`LangToggle.astro`; the admin bar carries the same shape) — and the whole flow works with JavaScript disabled — keep it that way; the spec calls it the single most important resilience decision in the build.

## The tag URL (read before touching routing)

- **The URL on a tag is `/t/<id>`, and the ID is either OPAQUE or one of the captain's NAMED bed ids — nothing else.**
  Opaque was the only rule, locked on the wayfinder map (issue #3, decision 3; re-keyed from `/b/<plate>` in issue #5): the plate encodes site type and neighbourhood, a tag's site is unknowable at encoding time, and re-encoding means physically visiting every tag.
  **On 2026-09-12 the captain deliberately overrode that for his three W 171st/Haven runs**: "the bed IDs should be name XE170171HFW … it's supposed to be the url actually and the bed id."
  He reaffirmed it knowing the trade — a readable id broadcasts which bed it is, and renaming means re-encoding the chip — because the id a neighbour reads off the guard, the URL, and the bed id the team says out loud must be the same string.
  Do not "fix" the named ids back to opaque; the opaque format stays valid beside them for every already-minted tag and future bulk batch (tag-id.ts records the whole override).
  The format still has to tolerate NTAG424 query parameters later (map decision 4): route logic must ignore unknown query params, which is also why tap suppression matches only our own flags (`plaque-url.ts`).
- **ID formats: 8 chars (opaque, issue #5) or 11 chars (the named E run), both Crockford base32, lowercase canonical, alphabet `0-9a-z` minus `i l o u`.**
  `src/lib/tag-id.ts` normalizes lookups — case-insensitive, strips hyphens/spaces, maps `i`/`l`→`1` and `o`→`0` — so an ID typed off a sign still resolves; `u` has no mapping and is simply invalid, and so is any length but the two known ones (`TAG_ID_LENGTHS`).
  The captain's ids fit the alphabet exactly as he spells them: `/t/1NHFW171` normalizes to `/t/1nhfw171`, whose bed's plate is `1NHFW171` — the named runs' S and N ids share the opaque length, and only the bindings registry tells the classes apart, which is fine because nothing routes on the difference.
  The plaque route redirects a non-canonical spelling to the canonical URL, query string intact — 302 for a GET or HEAD, 303 for anything that arrived with a body, so a client reading RFC 9110 doesn't repeat a POST at the one screen that logs a tap.
- **`/t/<id>/m` is DECORATION, and the app never reads it.**
  The captain's metal-guard marker ("that denotes if it's metal or not … decoration only"): the chips on `1NHFW171` and `2NHFW171` are encoded with the `/m` suffix so a human reading the tag sees the material.
  `src/pages/t/[tag]/[suffix].ts` redirects a known decoration to the bare bed URL and 404s anything else; it never touches the store, and `Bed.guard` stays the single source of truth for material — branching on `/m` would let the chip and the record drift the day a guard is replaced.
  Named sibling screens (`/mine`, `/care`…) are static segments and outrank the dynamic suffix, so `/m` can never shadow one; `tests/named-beds.e2e.test.ts` pins all of it.
- **Tag → site is a binding, and only `src/lib/tag-bindings.ts` knows it.**
  A tag is a physical object, a site is a place; theft is expected.
  Retiring a stolen tag (`retiredAt`) and binding a replacement to the same plate loses no history, because reports and events are keyed by the plate, never the tag.
  The registry is a checked-in table *by decision*: the team binds pilot tags itself (map note 14 — paperwork binding suffices until ~tag twenty), the in-field claim flow is a later ticket, and until it lands nothing at runtime writes a binding.
  When that flow arrives, the binding moves behind the `Store` interface; `resolveTagParam` is the only thing the route helpers call and the only thing routes reach it through, so the swap is contained.
  **One tag may have only one active binding; one BED may carry several** (`assertValidBindings` is unique on the tag side only) — the captain's rename left `8nhfw171`/`9nhfw171` bound beside the opaque tags they supersede, and a replacement for a stolen tag is bound beside the row it replaces until somebody retires it.
  Where a bed must be reduced to ONE URL — the digest's steward link (`mineLink`, digest.ts) — the **most recently bound active row wins**: the newest tag is the bed's current address, and the older URL keeps resolving for whoever already holds it.
  That ordering is a plain string compare, which is why `assertValidBindings` holds `boundAt` and `retiredAt` to one canonical UTC stamp shape (`Date.toISOString()`, milliseconds and `Z`): equal field widths are what make lexicographic order chronological order, so the shape is an invariant of the registry rather than a convention of its typists.
  The four opaque W 171st IDs there — and the 22 named-run ids beside them — were **minted in this repo ahead of the guards going in**: nothing was read off hardware, so for those rows the table is the SOURCE for what must be encoded onto the chips, not a record of what is already on them; whoever encodes them writes those exact IDs (the two metal-guard chips with the `/m` suffix), and a mismatch is repaired by re-encoding the tag, never by editing a row.
- **An unbound tag is a normal state, not an error.**
  A well-formed ID with no active binding renders the calm "not assigned to a bed yet" screen (with the ID on it) at 404 — never a 500.
  It logs no tap: sites own history and an unbound tag has none to write to.
  POSTs at an unbound tag are answered before any rule runs, and pay `abandonBody`'s bounded drain (`request-body.ts`) for the body on the way out:
  a body the app never touches is one Node dumps to its end for us, so refusing without reading is the expensive answer rather than the free one.
  `requireBoundTagForPost` / `requireBoundTagForForm` / `requireBoundTagForView` (`src/lib/tag-route.ts`) are what every route behind `/t/<tag>` resolves through, which is where that ordering is kept.
  The four POST endpoints (`requireBoundTagForPost` — `report`, `applause`, `clear`, `rename`) answer 404 in plain text — nothing is submitting a form there.
  The screens (`requireBoundTagForForm` / `requireBoundTagForView`) send the visitor to the door screen instead, which answers 404 itself, so the calm screen lives in exactly one place: 302 for a GET, 303 for a POST at `adopt`, `auth` or `signin`.
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
  The scheduled digest function is the one caller that `BUILD_TARGET` cannot protect: Netlify bundles it with its own esbuild, so the Vite define is absent and `build-target.ts` answers `'node'` there, which disarms `getStore()`'s netlify guard. `netlify/functions/digest.mts` therefore asserts `TREEBED_STORE === 'blobs'` itself — without it the digest would build a `LocalStore` on an ephemeral filesystem and read an empty dataset rather than refusing.
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
  The per-bed slot cap (`min(slots, offeredSlots)`, and `slots` itself bounded by `MAX_BED_SLOTS`), one-report-per-person-per-bed-per-NY-day, single open report per bed, one applause per person per bed per NY day, escalate-to-dumping-once, the note cap, the typed-field caps (`MAX_NAME_CHARS` / `MAX_EMAIL_CHARS` / `MAX_ADDRESS_CHARS` / `MAX_TREE_TYPE_CHARS` / `MAX_BED_NAME_CHARS` / `MAX_BED_NOTE_CHARS`, trimmed rather than refused), first-steward bed naming, and the sign-in link's mint/verify/burn with its two rate caps.
  Every typed field — the visitor's care note included (`noteFrom`) — goes through `capped` (`typed-text.ts`), which DROPS the bidirectional-format overrides — they are zero-width — and COLLAPSES control characters and whitespace runs to a single space before it trims and cuts — a hand-built POST is the only thing that can carry a U+202E into a field that renders as a leaf beside copy of ours, and a textarea's own CRLF must stay a gap between two words rather than glue them together.
  Anything in the browser is editable in devtools (spec §7).
- **A rule that checks state before writing it runs inside `store.transaction()`, and reads and writes through the `tx` the callback is handed — never through the store it came from.**
  A bare sequence of store calls interleaves with concurrent requests, and two reports open on one bed is unrecoverable through the UI — `closeReport` only ever finds the first.
  `tx` is a distinct object precisely so a call arriving from another request while the transaction waits on its disk write is still recognized as somebody else's and queued.
  Any new `Store` implementation must make the callback exclusive and commit or roll back its writes as a unit.
  Every mutation goes this way, including the per-tap event — a write outside the committed path can be discarded by an unrelated rollback.
  **A transaction whose callback writes nothing still commits a revision on Blobs** — the whole dataset is re-uploaded either way — so a press that will usually match nothing decides that on a plain read FIRST and opens the transaction only when it has something to write.
  The unsubscribe POST, the admin's resume-digest POST (`steward-digest.ts`) and the digest's no-adoption skip all have that shape; the transaction still re-decides every check, so the read is an optimization and never the gate.
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
  A steward's public handle is GENERATED instead (`generateUsername` in `service.ts`) — `<Word>Steward<number>`, e.g. `@MapleSteward42`, the captain's 2026-09-11 ask — for every new steward, tap adopt and admin pen-and-paper alike; existing handles (the seeded `@marisol_r`) keep their shape.
- **Sign-in is an emailed single-use LINK (`/t/<tag>/auth` → `/t/<tag>/signin?token=…`), never a typed code** — a code is relay-phishable through a cloned plaque page, a link resolves against our own domain.
  **Opening the link spends nothing**: mail gateways (Outlook Safe Links, corporate proxies, antivirus) prefetch URLs in incoming mail, so a token burned by a bare GET would be spent before the steward ever saw it. The GET renders an interstitial with one button — consulting the store about the token not at all, so it is also no oracle — and the plain-form POST behind it is what verifies, burns, and signs in. One tap in the mail, one tap on the page; still the tap-to-sign-in shape, still no script.
  The rules live in `service.ts` (`requestSignInLink` / `consumeSignInToken`): 32 random bytes, stored only as a SHA-256 (`SignInToken`), 15-minute expiry, burned on first use, bound to the bed whose auth screen minted it — a link opened at another bed's URL refuses WITHOUT burning, since whoever holds a token is its rightful recipient.
  The raw token is never stored (the store holds a SHA-256) and never logged; the only response it is echoed into is the interstitial's own hidden field, which is the form that spends it and is why that response carries `cache-control: no-store`.
  `tests/signin.e2e.test.ts` asserts both halves against a real server — the hidden field is there, and the token appears nowhere in the store file.
  A redirect of ours never forwards it either: `tag-route.ts`'s `forwardableSearch` strips `SECRET_QUERY_PARAMS` out of every redirect of ours — the hop an unbound tag or a retired bed sends the signin screen on, the plaque's canonical-spelling hop and the `/m` decoration hop alike — because a `location` header is what platform access logs keep and the door screen it lands on sets no `no-store` (`tests/tag-route.test.ts`).
  Rate limits are counted IN THE STORE (`SignInRequest`, emails keyed through `hashSignInEmail` — an HMAC over the signing secret, so the ledger is not a checkable list of who typed an address at a tree), not in memory, because function instances scale horizontally: per email and per bed per hour, refused attempts not recorded so a stranger cannot hold an address at the cap.
  The per-bed cap counts only requests that RESOLVED to a mailable steward (`SignInRequest.resolved`), because a tag URL is printed on a public street object: if misses counted, a passer-by could spend the window on made-up addresses and lock every real steward of that bed out. A row is appended for BOTH kinds, and only the per-bed filter reads the flag — do not "simplify" that into skipping the write, which is what keeps the two indistinguishable.
  What then bounds the misses per bed is a separate counter, not a cap on the answer: `MAX_SIGNIN_MISSES_PER_BED` (200 per window, `SignInMissWindow`, one row per bed rewritten in place) is how many unresolved requests a bed's screen may WRITE, since every request is a whole-dataset commit on Blobs and the per-email cap resets with each fresh address. Past it the request still answers "check your inbox" and simply records nothing — it leaves the transaction by throwing an internal signal, because a callback that writes nothing still commits a revision. Residual, stated: that skipped commit is measurably faster and only an unresolved request skips it, so on a bed already pushed past the ceiling it widens the resolved-versus-unresolved timing gap rather than being enumeration-neutral — the same accepted tier as the mail call below.
  The auth screen answers "check your inbox" for known and unknown emails alike, and the rate-limit refusal is decided off the hashed ledger before any user lookup, so it is identical for both.
  Residual, stated: the Brevo call a real steward's request makes is a timing signal an unknown email's request lacks — the same accepted tier as the per-IP limiting still owed at the platform.
  The PIN path is GONE — no `pinHash`, no bcryptjs, no `MAX_INFLIGHT_PIN_HASHES`, no `TREEBED_SEED_PIN` — and `hasSignInRoute` is re-derived on every load as "has an email" (`normalizeData`), so pen-and-paper stewards the admin entered WITH an email can sign in too.
- **What carries a steward day to day is still the session cookie, which lasts a year**; the link is the rare way back in after cookies are lost. `/t/<tag>/signin` sets the same `tg_session` and lands on `mine`.
- **A counted applause can mail the bed's stewards — at most ONE notification per bed per NY day, however many people applaud** (captain, 2026-09-12: "i realize when applause is sent i dont get emailed").
  **The press mails nothing.** `sendApplause` claims the day (`Bed.applauseNoticeAt`) and QUEUES the notice (`Bed.applauseNoticeDueAt`); the daily scheduled function delivers it (`runApplauseNotices` in `digest.ts`, beside the digest's own run), and the words are `applause-mail.ts`.
  Nobody standing at a tree waits on a Brevo call — a 5s timeout with a retry behind it, in front of the thank-you takeover — and a queued notice survives the response on the netlify target, where awaited-after-response work does not.
  It runs whatever `NetworkSettings.digestCadence` says: the cadence is how often a steward wants the periodic summary, and this is a different mail. Mail being unconfigured is what stops it, and leaves the notice queued rather than burning it.
  Delivery is claim-then-send, the digest's own shape (`claimApplauseNotice`): the claim commits before the send, so a rerun never doubles a notice and a failed send forfeits that day's.
  Who is mailable is resolved AT SEND TIME on the digest's own bar — an active adoption, an email on record and no `digestOptedOut`, ONE flag for every courtesy mail, same signed unsubscribe link — so a steward who adds an email between the press and the morning is included, and a pen-and-paper steward with no email is never a recipient. A claim that finds nobody mailable hands the day BACK (`applauseNoticeAt` to null), so it is not spent on an empty recipient list.
- **The mail plane is `src/lib/mail.ts`** — Brevo transactional over raw fetch (timeout, one bounded retry on 429/5xx, mirroring the sister site's client), selected by environment: `BREVO_API_KEY` set → real sends from `TREEBED_MAIL_FROM`; no key outside production → each message is one JSON file in `.data/outbox/` (what local runs and the e2e suite read the link from); no key in production → mail unavailable, the sign-in screen says so, everything else works.
  "Production" is detected without `import.meta` (`NODE_ENV`, or `TREEBED_STORE=blobs`) because the scheduled digest function is bundled outside the Vite build.
  `TREEBED_PUBLIC_ORIGIN` is the only origin emailed links may claim in production — a Host-derived origin would let a caller point somebody else's sign-in link at a host of their choosing; unset in production, mail is unavailable rather than guessed.
  Never send real mail from a test or a local run: no test sets `BREVO_API_KEY`, everything goes through the outbox — the captain's explicit "do not send anything".
  That is structural rather than incidental: an e2e server is spawned through `serverEnv` (`tests/helpers/server-env.ts`), which STRIPS `BREVO_API_KEY`, `TREEBED_MAIL_FROM` and `TREEBED_PUBLIC_ORIGIN` out of the inherited environment, so a developer whose shell exports the org's real key still drives the outbox. Spawn a server any other way and that guarantee is gone.
- `TREEBED_SESSION_SECRET` is required in production; the app refuses to sign cookies with a generated one. The `.data/session-secret` fallback is dev-only.
  It is no longer only the cookie key: the unsubscribe link's signature (`unsubscribe-link.ts`) and the sign-in ledger's email HMAC (`hashSignInEmail`, `service.ts`) are keyed by the same value, so a rotation invalidates every live unsubscribe link and re-keys the ledger — the sign-in rate limits start from empty, which is the safe direction.
  **`src/lib/signing-secret.ts` is where it is resolved, and it owns the dev fallback file.**
  It reads the environment variable with no `import.meta`, because the scheduled digest function is bundled by Netlify's own esbuild and a Vite define is absent there — the function has to key MACs the app can verify.
  `session.ts` keeps its own `import.meta.env.PROD` production predicate but takes the dev fallback from `devFallbackSecret()` rather than generating its own, because two generators racing the same file would end up disagreeing about the key.
  The requirement is checked twice so a misconfigured deploy can't reach traffic: `scripts/preflight.mjs` runs as npm's `prestart` and `prepreview` and refuses to boot, and `src/middleware.ts` asserts at module load so a server started any other way fails on its first request of any route rather than on the first one that touches a cookie.
- **Every public POST reads its body through `src/lib/request-body.ts`, never `request.formData()` directly** — the adapter's own default limit is 1GB of buffered memory.
  The comment block at the top of that file is the whole-surface sweep — size, time, concurrency, peak heap, and what the caller sees for every publicly reachable route — and a new route belongs in it.
  Four bounds, because three rounds of review each found one of them missing somewhere: a byte cap per body, a time bound on *both* the accepted and the refused read, an in-flight byte budget across all reads at once, and the drain headroom below.
  A route bounds only the method it exports, so `src/middleware.ts` drains once after `next()` settles as the backstop for every route and every method — a no-op wherever the body was already read, and what covers the `PUT` at `/report` no route handler ever sees.
  It drains in a `finally`, so a route that throws is covered too: Astro turns the rejection into a 500 of its own, and the unread body has to be accounted for before that answer is written.
  The four POST endpoints export `ALL = postOnly` (`tag-route.ts`) so an unhandled method is answered 405 rather than by Astro's own 404, which logs a line per request and would let an anonymous caller decide how much stderr it costs us.
  One refusal is deliberately not ours: Astro's cross-origin guard runs ahead of our middleware and answers a form-content-type POST with a missing or mismatched `Origin` header 403 with the body unread.
  Taking that over would mean turning off `security.checkOrigin` and re-implementing CSRF ourselves to recover work spent on requests that were going to be refused anyway — accepted and recorded in the sweep comment instead.
- **The photo cap is per target: 12MB on node, 4MB on netlify.**
  Netlify caps a synchronous function's request payload at 6MB and buffers the body before the function is invoked, so a larger upload never reaches the route: the platform answers a bare 413 and `too-large.astro` — whose whole point is handing the visitor back the report they already filled in — never renders.
  Set below the platform's own limit, every refusal a visitor can provoke is one this route makes gracefully.
  The streaming bounds below are measured against the node adapter's real sockets either way; on netlify the body has already been buffered by the platform by the time we read it, so what they buy there is the graceful screen, not the heap.
  Every bound in this section is a module-level counter, so it bounds one process: the whole server on the node target (what `npm start` runs and what the e2e suite measures), one function instance on netlify.
  Fleet-wide peak heap there is these numbers times however many instances the platform is running.
  They are per-instance costs, not the pilot's surface-wide DoS ceiling — bounding the surface is the per-IP limiting at the platform tier already noted as owed.
- The report route buffers a body ONLY when its head shows an attached photo, because the photo is stored now (captain, 2026-09-12): `readCappedBodyWhen` starts every read on the head-only reservation, decides off `photoAttachedFromHead` the moment the first `HEAD_BYTES` are in, and upgrades the in-flight reservation by `2 × cap` for exactly the uploads that carry one — an upgrade the budget has no room for refuses as `busy` with the head kept, so the too-large screen still carries the picked categories and the note.
  A photo-less report stays what it always was: fields off the head, kilobytes of heap, the rest read and dropped.
  `textFieldFromHead` reads the fields either way, which only works while the care screen's markup keeps its text parts ahead of the file input — browsers send parts in DOM order. Keep it that way if the screen gains a field; `tests/care-form-order.e2e.test.ts` pins it by reading the order off the rendered care screen and posting a body built in it, so a reordered field fails the suite rather than the street.
  The stored photo's bytes live OUTSIDE the dataset (`PhotoBlobs` in store.ts — `.data/photos/` locally, `photo/<id>` blobs on Netlify, clear of the `rev/` pruning), and the dataset holds only the `ReportPhoto` row, because every commit re-uploads the whole dataset. The blob is written route-side BEFORE `reportProblem` runs and deleted when the rule declines it, so a row can never name bytes that were never stored — and the presses the rule is about to decline are filtered off a PLAIN read first (`reportPhotoCouldBeKept`), so today's second say, a neighbour already counted, and a report at its photo cap never pay for an upload the rules were never going to keep; that read is an optimization and never the gate (the transaction re-decides, and the orphan delete still covers the race).
  **The whole photo path is `report-photo.ts`, and every failure on it — the pre-read, the upload — is logged and answered as "no stored photo" rather than raised**: an optional attachment must never cost the visitor the report they already typed, so the press still files with `photoAttached` recording the attempt, which is exactly what the pre-storage build did with every photo (`tests/report-photo.test.ts`).
  `MAX_REPORT_PHOTOS` (service.ts) bounds one report's storage the way `MAX_CONFIRMATIONS` bounds its presses, and the stored content type is allowlisted (`storedPhotoContentType`) so the admin serving route can never serve scriptable markup.
  `readCappedForm` still buffers the text-only forms, where the whole body is 64KB and two copies of it are ~128KB.
- A refused body is read to its end and discarded rather than cancelled: cancelling the reader destroys the socket, and a client still uploading gets a connection reset instead of the response.
  The drain budget is absolute, not a multiple of the cap — 24MB of headroom on the report route (covering the 12–30MB a real phone photo lands in), the cap itself on the text-only forms — and bounded in time as well: `DRAIN_IDLE_MS` for a sender that goes quiet, `DRAIN_TIMEOUT_MS` in all, both under Node's own 300s request timeout and both above what a slow phone upload needs.
  `DRAIN_TIMEOUT_MS` is a budget for the drain, not an extension of the request: the drain deadline is clamped to `READ_TIMEOUT_MS` measured from the start of the read, so a body that crosses the cap late can't run `time-until-over + 180s` past the 300s backstop and lose the very screen the drain exists to deliver.
  `READ_IDLE_MS`/`READ_TIMEOUT_MS` are the same bounds on a body nothing has refused — an 11.9MB trickle is under the cap and still may not hold a request open forever.
  Those four are the report route's, sized for a 12MB photo on a bad uplink. Every other public POST reads under `FORM_READ_TIMEOUT_MS`/`FORM_READ_IDLE_MS` (10s/5s, drain included), because the bound that fires is also the bound that releases the read's share of `MAX_INFLIGHT_BODY_BYTES`: on the photo-sized clocks, a cookie-less client trickling a byte every 25s held a reservation for four minutes per socket, so a few hundred of them at ~40 bytes/sec together exhausted the budget and every public POST answered `busy` until they timed out. Heap stayed bounded; availability did not. A body that can only be one button or five typed fields gets seconds.
  The report route's minutes are earned rather than granted, for the same reason: until the first `HEAD_BYTES` are in, every read — that one included — is on `HEAD_READ_TIMEOUT_MS`/`HEAD_READ_IDLE_MS` (the same 10s/5s), on the drain as well as the accepted path. A phone puts the head of a 20MB upload on the wire in well under a second and a report with no photo is a few hundred bytes in total, so the realistic cases are untouched; what the head phase removes is the one route where four minutes could be held for a body that never showed a photo at all, which made `/report` the cheapest reservation on the surface at ~30 bytes/sec across a few hundred sockets.
  Residual, accepted and node-target only: past the head the long clocks are back, and since the photo is stored a head that merely CLAIMS one — a `filename="…"` in those first 8KB — buys the keep-upgrade's `2 × cap` reservation before a single photo byte has arrived.
  On the node target that is 24MB of the 48MB budget per socket, so roughly two sockets trickling a byte every 25s can hold the photo-carrying path at `busy` continuously; photo-less reports stay head-only and hundreds still fit.
  On netlify — what production deploys — the platform buffers the whole body before the function is invoked, so a trickling socket never reaches this code.
  Same accepted tier as the concurrency ceiling below, to revisit before ever serving the pilot from the node target behind the custom domain; the known fix is to grow the reservation as bytes actually accumulate, or to hold the head clocks until some real byte threshold past the head has arrived, rather than granting both on the claim.
  Past a bound the read stops and does *not* cancel: cancelling leaves the response unwritten and the socket idling until that 300s timeout, while walking away lets the route answer and lets Node close the connection behind a request body it never finished. Measured both ways — `tests/report-upload.e2e.test.ts` posts real bodies at a real server, because this is not a thing to reason about.
- `MAX_INFLIGHT_BODY_BYTES` is what one request's cap can't bound: how many arrive at once.
  Each read reserves what it may hold *at its peak* — `2 ×` the cap when buffering (the chunks, then the merged copy), `HEAD_BYTES` when head-only, and `CHUNK_ALLOWANCE_BYTES` either way for the chunk in hand — and it caps concurrency in the unit that matters (hundreds of head-only uploads fit; a buffering route gets a handful).
  Reserving only the bytes a read means to *keep* under-counted the report route by 8–16×, which is the same as not having the bound.
  Known ceiling, stated rather than re-architected (the captain's call): a photo-carrying report reserves `2 ×` the photo cap, so on the node target that is 24MB of the 48MB budget — TWO concurrent photo uploads per process, and the third answers `busy`. On netlify it is `2 × 4MB`, about six per instance, and netlify is what production deploys. A photo-LESS report is still head-only, so hundreds of those fit either way. Revisit the node number before ever serving the pilot from the node target behind the custom domain; the fix is a bound value the captain owns, not a change to how the reservation is counted.
- `MAX_INFLIGHT_BODY_BYTES` covers admitted reads only; `MAX_SHED_READS` (64) bounds the refused ones, which each hold a head plus the chunk in hand while they shed.
  The peak heap for every read holding anything is the two together: 48MB + 64 × 72KB, about 52MB. Neither number means anything without the other — a budget that bounds only what it admits is bypassed by everything it turns away.
  Both numbers bound the READ; the report route's blob WRITE sits outside the accounting, because the reservation is released when the read ends and the photo's bytes live on through the upload — about `2 × cap` per admitted upload for the duration of that one write, and no longer: the route drops every reference to the body and the photo view the moment the blob is written, so nothing MB-scale is pinned across `reportProblem` or the redirect.
  Same accepted node-target residual tier as the reservation ceilings above.
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
  **A steward of the bed logs no tap on it, ever.**
  The door screen suppresses the event for a signed-in steward of that bed as well as for `POST_ACTION_FLAGS`, because a steward returning to their own bed is not a passer-by tapping the tag — and that holds for every return path, a browser bookmark and history included, which a flag on one link cannot cover.
  So the bookmark cue (door 2 and the "Adopted!" takeover) prints the bare `/t/<tag>` and links to exactly that: what a steward saves and what the link carries are the same address, and neither counts.
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
  Since the captain's 2026-09-12 "yes, any steward can rename it", ANY active steward may rename the bed from their own view (`mine.astro` → `/t/<tag>/rename` → `renameBedBySteward`), each rename a `rename` event carrying the chosen name — who changed it, when, and to what, on the record. The admin still never types or edits a name; the takedown switch is unchanged, and an empty rename is refused rather than read as one.
  The name is **visitor free text rendered as typed in BOTH languages** — a name is not translated — so it is always its own leaf beside the bed's identity (both doors, plus `mine.astro`), never spliced into a bilingual sentence, and it is set in Londrina Solid because this is a plaque, not a form field.
  An unnamed bed renders no element at all.
- **A steward is shown as username first, then initials — `@MapleSteward42`, `M. R.`** (`publicHandle` / `publicInitials` in `types.ts`).
  The handle is GENERATED, not typed and not derived from the name: the approved form has no username field, and `generateUsername` rolls `<Word>Steward<number>` from a curated word list — so the initials printed under it are the only thing the name puts on the street.
  The admin's add-steward form may still type one deliberately; a typed handle that collides is refused, not mutated.
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
  `User.hasSignInRoute` and `User.recordHeldOnBehalf` record that explicitly, and the two flags are distinct on purpose: `hasSignInRoute` now simply tracks whether an email exists for the sign-in link to reach, while `recordHeldOnBehalf` says who created the record.
  A pen-and-paper steward written in WITH an email has `hasSignInRoute: true` and `recordHeldOnBehalf: true` — they can sign in, and the team still holds their record.
  **Never read a missing email as consent to be contacted.** The digest (below) reaches only stewards with an email, and its unsubscribe link works with one click.
- **The NYC sync is read-only and additive.**
  `Bed.nycMissingSince` is a flag for a human and nothing else: a bed that disappears from NYC's data is never deleted, unpublished or orphaned, and its adoption is never touched.
  The captain was asked and answered "we don't know" (answered open question 2), so the build takes the one action that cannot destroy a live adoption.
  Whoever implements the sync: do not turn that flag into a cascade.
  `normalizeData` in `store-dataset.ts` is held to the same rule — it fills in fields a stored record predates, additively and losslessly, because the pilot store is live, seeding only runs on first contact, and there is deliberately no migration step.

## Design tokens

- The palette is the identity the captain approved across the tap-flow review (`design-record.md`, constraint 2), and it lives in `src/lib/presentation.ts` — **not** in `src/styles/global.css`, which names no colour at all.
  See "Presentation is data-driven" above.
  Poster Beige `#eae9da` · Post No Bills Green `#4e6e65` · Deep Purple `#65409a` · Street Sign Yellow `#f3cf02` · Roadtop Black `#1d1d23`, with roles: purple = the admin's action colour and nothing else, yellow = attention (**always with black on it, never white — white on yellow is 1.53:1**), green = all-clear/adopted and — since the captain's 2026-09-11 reversal — the solid page ground of the whole tap flow, beige = the secondary (the ink and buttons on the green, the paper under containers and tiles) and the admin's page ground.
  The ground reversal took the purple out of the visitor flow entirely — it is 1.36:1 on the green — so there is no action colour on a screen a neighbour sees.
  The primary action stays distinct from the secondary WITHIN each screen (filled beige `btn-on-clear` against outlined `btn-on-clear-outline`), which is the approved hierarchy; what is gone is a colour meaning "ownership action" across screens, and inventing a new adopt treatment on the green is a look change the captain did not ask for.
  For the same reason affirmation on the green is a FILL INVERSION, not an ink change: every ink the green carries is the one beige, so the care screen's attached-photo pill fills with the beige and takes the green as its ink (`--fill-affirm` / `--on-fill-affirm`, the `band-clear` vocabulary) rather than swapping one beige for another.
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
- Points/streak earning rules, the 1-day grace period, 311 handoff, NFC tag cryptographic verification, provisioning flow. (Photo storage left this list 2026-09-12 — care photos are stored and shown in the admin.)
- **Group theming.** `presentation.ts` is shaped for it and must not grow it — `Block` (types.ts) is an admin grouping, deliberately NOT the theming seam.
- **Pen-and-paper steward outreach — reaching a steward we hold NO email for.** `User.recordHeldOnBehalf` marks who to reach when a contact route exists; the mail plane is not that route, because the digest and the sign-in link both reach an address the steward gave us, and a missing email is never consent to be contacted by some other means.
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
`add-steward.astro` and `add-bed.astro` sit beside the block page as the two forms that need a page of their own, and `delete-bed.astro`, `restore-bed.astro` and `delete-photo.astro` as the three confirmations that do.

- **Gate: `TREEBED_ADMIN_KEY`** (session.ts). Where no key is configured, every /admin route answers 404 — a deploy that never configured one has no admin, deliberately; the pilot site has held a key site-level since 2026-09-10, so its /admin is live. Dev generates one into `.data/admin-key`. The signed `tg_admin` cookie lasts 30 days. This is deliberately NOT an account with a typed secret, and not the steward's emailed link either (the admin is a role, not a steward's mailbox): a long random key compares constant-time, costs no hashing and offers no enumeration. Per-IP throttling is still the platform-tier debt recorded in request-body.ts.
- **`Bed.offeredSlots` is a rule, not a display state**: `adoptBed` refuses past `min(slots, offeredSlots)`, and `BedView.openSlots` is derived from that same bound — the door screen and `adopt.astro` gate the invitation on it, so an unoffered bed shows no adopt button and no form the rules would then have to refuse. Four of the six W 171st beds seed with `offeredSlots: 0` — opening one is the captain's act, on this page; the two he renamed onto N-run ids (`BED-WH-1712`, `BED-WH-1713`) seed offered, because he opened them himself.
  The switches submit slot NUMBERS, not a count: `offeredSlots` covers slots 1..n, so a gapped selection is refused (bilingual, 422, switches re-rendered as submitted) rather than saved as its size, which would flip a switch nobody touched.
- **The bed-name row is a takedown, not an edit.** It renders in the opened bed's panel only when the bed HAS a name, and the switch removes it on SAVE CHANGES (`BlockSaveInput.bed.clearBedName` → `bedName: null`), touching neither the bed nor its adoption. Visitor free text on a screen bolted to a street needs a way down; the admin never authors a name, and the only way one comes back is a later first steward naming the bed again.
- **`POST /admin/sign-out` closes the session**, and the control sits in the admin bar on every admin screen (`AdminScreen.astro`) — the 30-day `tg_admin` cookie opens PII on a phone that gets handed around, and the alternatives were clearing site data or rotating the key for everyone.
- **The bed profile is per-bed data the admin keeps and the public "About this bed" page states** (`/t/<tag>/about`, reached by a small text link under BOTH doors' buttons — never a third big button).
  `Bed.guard` is one three-way field (`none`/`wood`/`metal`) — never a flag plus a material — and replaced the earlier ordered/installed date pair; older stored rows keep those dates untouched.
  It is also nullable, and null means NOT YET RECORDED: every seeded bed, every backfilled row and every bed the admin adds starts there, never at `none`, because the demo bed's tag rides a guard the old record never described and the W 171st tags go in with their guards.
  The About page omits the guard row entirely while unset and the admin panel marks it not set until the admin picks one.
  **`treePresent`, `plantsPresent` and `plantingRecommended` follow that same rule and are `boolean | null` for it**: three-way radios in the panel, null is NOT YET RECORDED, every seed and backfill starts there rather than at `false`, and the About page omits the statement until somebody has said — a default is not somebody having looked.
  Each of them is a radio rather than a switch because a checkbox cannot tell "unchecked" from "not sent"; the species is still named on the About page whatever the fact reads, because it is what the bed is FOR and both doors headline it.
  **The species is the profile's one TYPED row** (`tree-type-en` / `tree-type-es`), because a species is a name and not a yes/no: it is how the 20 fresh named-run beds get the species they seed without ("i will update it to match NYC parks"), it goes through the same `resolveSpecies` (service.ts) the add-bed form does — Spanish defaulting from `tree-species.ts`, a typed Spanish name winning, an unknown species degrading to "árbol", the table's own casing on a species it knows — and a CLEARED English name is the way back to NOT YET RECORDED.
  The one thing this row adds is that both fields arrive PRE-FILLED, so `resolveSpecies` is passed what the bed HOLDS: a Spanish value that is exactly what `resolveSpecies` itself gave the OLD English name — the table's name, or the generic "árbol" where the table has none — is our own answer and re-derives from the new one, while a name a human wrote survives the correction — otherwise correcting only the English name would pin a willow oak's Spanish to a red maple on a public screen. A form carrying neither field keeps what stands, like every other profile row.
  **Each of those four rows carries its own NOT RECORDED radio (`UNRECORDED_CHOICE`), which is the only way a fact goes back to unrecorded.**
  The absence of a radio cannot be that control — the captain records these one-handed on a sidewalk and a mis-tap must be undoable, while a form carrying no radio is a stale page or a hand-built POST — so the parse helpers (`guardMaterialFrom` / `bedFactFrom`) answer three ways: a value, null for the choice, and undefined for keep-as-it-stands, which `saveBlockSettings` distinguishes with `=== undefined` rather than `??`.
  One rule covers the whole profile: a field the form did not carry keeps what stands, notes included, so a partial POST blanks nothing.
  `plantsNote` and `recommendedPlantsNote` render only while their fact reads yes, and the save never blanks them, so answering "no" and back again restores the words.
  `plantsNote`/`recommendedPlantsNote`/`careNote` are admin-typed free text, bounded by `MAX_BED_NOTE_CHARS`, rendered AS TYPED in both languages (own leaf, no `data-en`/`data-es`) like `bedName`.
  The FAQ under the profile is network-wide copy (`ABOUT_FAQ` in copy.ts) so the captain edits sentences, not screens.
- **The bed panel states the bed's open report, read-only** (`AdminBedView.openReport`, the same record `mine.astro` reads): what was picked, the note, when it was opened, the `confirmedBy` count, and — under "Neighbours also said", from `AdminBedView.openReportConfirms` — what each confirming neighbour picked and typed, the same `confirm` events joined by `reportId` that the steward reads.
  It exists so the FAQ's "Trash Talk NYC sees the report" is true of a screen rather than of a CLI, which is also why the captain's surface must never see less of a report than the steward does; nothing on it writes, and closing a report stays the steward's act behind `/clear`.
  Both notes go through `capped` AT RENDER here as well as at the write, because the live pilot store already holds a note written before write-time sanitising reached the visitor's note.
- **Stored care photos render in the opened bed's panel and NOWHERE else** — the captain's "store the photos and show them in admin" (2026-09-12), with the privacy line unchanged: no public or steward screen may carry a stored photo or its URL.
  The open report's photos sit under its band (joined by `ReportPhoto.reportId`, the same exact join the confirms use) and earlier reports' photos stay below as the bed's history — a photo stays with its report when the report closes, and the ONLY removal is the admin's delete: a LINK to `delete-photo.astro` whose own POST does it, two deliberate taps like the bed delete, and a link for the same second reason RESTORE is one (the panel sits inside the page's single big form).
  The history is capped at the most recent `ADMIN_EARLIER_PHOTOS_SHOWN` (six) with the rest behind a plain `?photos=all` link the server reads — nothing prunes stored photos and each one is a full-resolution image served `no-store`, so an uncapped panel gets slower every week on the sidewalk; the OPEN report's photos are never capped, because those are the ones the captain opened the panel to act on.
  The bytes are served by `/admin/photos/<id>` behind the same gate, content type allowlisted at write and at serve plus `nosniff`, so an upload can never become scriptable markup on the admin origin.
- **Deleting a bed is RETIRING it (`retireBedByAdmin`, `Bed.retiredAt`), never erasing the row** — the plate is the join key its history hangs on, and `ensureCheckedInBlocks` would re-insert an erased seeded bed on the next load, so only the tombstone stays deleted.
  A retired bed drops off the street list, every rule and screen answers not-found for its plate (service.ts `getActiveBed`), a still-bound tag renders the calm "not assigned" screen without the registry-typo stderr line, and the plate and position are never reused.
  The delete is two deliberate taps: the panel's link only opens `delete-bed.astro`, whose own POST does it. One bed at a time — no bulk delete, on purpose.
  **The way back is `restoreBedByAdmin`**, reached from a "Deleted beds" section below the street list on the block page — `BlockView.retired` is what the page draws it from, and a retired row offers RESTORE and nothing else (no panel, no bulk act).
  It exists because the tag→site registry is checked in with no runtime write path, so without it a mis-tap on the live pilot would cost that tag its screen until somebody shipped a commit.
  Restoring clears `retiredAt` and touches nothing else, so the bed comes back exactly as it was. It is deliberately NOT a trash view: no retention policy, no auto-purge, no permanent delete.
  RESTORE is a LINK to `restore-bed.astro`, whose own POST does it — the same two-tap shape as delete, and for a second reason: the retired rows sit inside the block page's one big form, so a submit there would fire that form's submit handler, disarm the unsaved-changes guard and silently drop whatever the bed panel still held. Keep it a link; do not special-case the guard instead.
- `addStewardByAdmin` is the sidewalk case: email optional, `hasSignInRoute` true exactly when an email was given (the emailed link is the only sign-in), `recordHeldOnBehalf: true`, adoption `stewardKind: 'pen-and-paper'`. It may fill an unoffered slot (writing a neighbour in is the point) but never past `slots`. A typed username that collides is refused, not mutated.
- **The digest cadence is a network setting on the admin index** (`NetworkSettings.digestCadence`, saved by `POST /admin/digest`): off / weekly / every two weeks / monthly, DEFAULT OFF by the captain's explicit "do not send anything" — nothing mails anybody until he turns it on. The sending itself is the daily scheduled function `netlify/functions/digest.mts` driving `src/lib/digest.ts`: due stewards (active adoption, email, not unsubscribed, cadence elapsed) are claimed (`digestLastSentAt`, inside a transaction, BEFORE the send) so a rerun or crash never double-sends; content is the steward's beds, open report, applause since last digest, in `User.lang`; every mail carries a signed unsubscribe link (`src/lib/unsubscribe-link.ts`, `/digest/unsubscribe`) whose GET renders a one-button confirm and whose POST — the same POST RFC 8058's `List-Unsubscribe-Post` header advertises — flips `User.digestOptedOut`; the GET flips nothing, because mail scanners prefetch links and a silent permanent opt-out was ruled unacceptable. The recovery half is the admin control on the steward detail (`steward-digest.ts`) that clears the flag with the steward's say-so. Residual, stated: a provider-initiated one-click POST carries no Origin header, so Astro's cross-origin guard answers it 403 before any app code runs (the same guard request-body.ts records keeping); for those clients the `List-Unsubscribe` URL is the working path — it opens the confirm page. That same daily function also delivers the queued applause notices (`runApplauseNotices`), which do NOT wait on the cadence — see the applause bullet under "Security decisions". The scheduled function is bundled by Netlify's own esbuild, NOT the Vite build — nothing on its import path may rely on a Vite define or `import.meta.env`.
- **NYC identifiers are resolved or null, never invented.** The six beds' `plantingSpaceId`/`plantingSpaceGlobalId`/`treeId` were resolved against NYC's Forestry Planting Spaces (`82zj-84is`) and Tree Points (`hn5i-inap`) — method and citations sit on `w171Beds()` in `src/lib/checked-in-beds.ts`. `addBedByAdmin` creates beds with null NYC fields and the panel prints the unresolved marker; keep it that way.
  Since 2026-09-12 that match is IN DOUBT — the captain gave two of those beds north-side (`N` run) ids, and the south-curb geometry fit is what the whole six-space match rested on — so every one of those identifiers awaits his own NYC Parks pass.
  Until then they stay exactly as resolved: nothing may null them, re-guess them or shuffle them between rows.
  Read the docstring as the method, not as a settled answer.
- Admin styles are `src/styles/admin.css` — same law as global.css: no hex anywhere, tints via `color-mix` on the `--theme-*` roles, so the presentation tests still hold the whole surface.
- The admin is bilingual like everything else (`ADMIN` in copy.ts); tests/i18n.test.ts names the only three identical-in-both entries (ADMIN, DEMO, NFC) and fails any new one.

## Seed data

**The captain's real block seeds and BACKFILLS: `w-171-fort-washington-haven`, reference address 708 W 171st — six real beds `BED-WH-1711`…`1716` (five willow oaks with guards ordered in the real world; one white oak at position 5, no guard coming), each bound to its real NYC planting space and each seeding `guard: null` — not yet recorded, never `none`, because the tags go in with the guards.**
The checked-in records themselves live in `src/lib/checked-in-beds.ts` — a LEAF module with type-only imports, so the bare-node remediation scripts can read the same seed the app does (`scripts/steward-carry-apply.mjs` applies it before a carry, which is why a run bed no commit has persisted yet is still found); store-dataset.ts re-exports them.
`ensureCheckedInBlocks` (store-dataset.ts → `ensureCheckedInRecords`) runs inside `normalizeData`, so an already-seeded store — the LIVE pilot store included — gains the blocks and beds on its next load, insert-only by key: nothing the captain edits on the admin page is ever overwritten by a later load. That is how new checked-in records reach live data without a migration step; follow the same shape for the next block.

**The captain's three NAMED runs (2026-09-12) span 22 bed ids, of which 20 seed as fresh beds** (`captainRunBeds`, one block per run so the admin tells them apart by label, not id): `1E170171HFW`…`6E170171HFW` (east sidewalk of Haven Ave, W 170–171), `1SHFW171`…`7SHFW171` (south side of W 171, Haven–Fort Washington), `1NHFW171`…`7NHFW171` (north side of the same block).
The id is the bed's plate AND — lowercased — its tag URL, by the captain's decision (see "The tag URL").
Everything about the fresh beds seeds UNASSERTED — species and every profile fact not yet recorded, NYC ids null, no address (his street numbers are loose cluster references, not locators) — except what he stated himself: the two metal guards (`1NHFW171`, `2NHFW171`, whose chips carry the decorative `/m`) and the plant facts on `2SHFW171` (planted) and `5SHFW171` (not planted, planting not recommended). Each opens with its one slot OFFERED: "just want to get this ready for people to adopt and name."
**`8NHFW171` and `9NHFW171` are RENAMES, not fresh beds**: the captain identified them (2026-09-12, "Can you change …/t/1hc0t9cj for the end to be 9NHFW171 and then …/t/729v19w4 change to 8NHFW171") as the existing beds `BED-WH-1713` and `BED-WH-1712`, so those two named ids bind to the existing plates in tag-bindings.ts — beside the old opaque tags, which stay live because the old URLs may already be in people's hands; retiring them is the captain's later call. He also said "no plants and don't recommend planting" for both; the checked-in seed carries that for fresh stores, and `scripts/seed-captain-facts.mjs` (dry-run default, fills only fields still NOT RECORDED, never an automatic backfill — the admin's unrecord radio must stay able to stick) is what puts it on the LIVE rows the insert-only seed cannot touch.
That pass covers FOUR plates, not two: `BED-WH-1712`/`BED-WH-1713` and also `2SHFW171`/`5SHFW171`, whose rows the live store persisted blank in the window between the deploy that seeded them and their facts reaching the seed — so it sources its facts from both halves of the checked-in seed (`w171Beds` and `captainRunBeds`).
Where the seed asserts nothing it writes nothing, which is why `2SHFW171`'s planting recommendation stays NOT RECORDED: the captain said only that it has plants.
The live store also still holds the two BLANK rows PR #29 seeded under those plates before the rename landed, reachable by no tag now that `8nhfw171`/`9nhfw171` resolve to the existing beds; `scripts/retire-orphan-run-beds.mjs` is the second half of the same operator pass — it RETIRES them (reversible from the admin, never deleted), refusing and reporting only a row that still holds an ACTIVE adoption so a human carries the steward off with `scripts/carry-steward.mjs` first — the carry's own leftover released adoption deliberately does not refuse the re-run, or that recovery could never finish, and anything else the row carries (a bed name, reports, events, a profile edit) is kept by the retire and named in its report line.
**Which run beds the other four older `BED-WH-171x` beds are is still unsaid** — the captain names them one by one, and addresses can't (loose cluster references) — so no other named id maps onto a `BED-WH` plate and those four keep their old tags untouched.
When he names another (his own adopted bed included), the shape is what `8N`/`9N` set: bind the named id to the existing plate, keep the old tag live, and if a steward ever landed on a duplicate record, `scripts/carry-steward.mjs` → `carrySteward` (steward-carry.ts) moves them keeping `adoptedAt`, reversibly (swap `--from`/`--to`); history stays keyed where it was written, and a duplicate bed retires rather than deletes.

One hand-seeded DEMO bed `BED-HRL-0847` — planting space `#15850293`, which is a mockup number matching NO real NYC record (checked 2026-09-10), a willow oak — with seeded steward `marisol_r` (Marisol Rivera, shown publicly as `@marisol_r` / `M. R.`).
It deliberately lives in its own `demo`-flagged block (`w-138-acp-demo`), never in the captain's, so the admin can reach its live pilot history without a fake bed reading as part of a real street.
The sign-in flow is driven locally through the dev outbox: request a link at `/t/2mq2amhv/auth` with the seed email `seed-marisol@example.invalid` and read it out of `.data/outbox/` — the seed holds no secret of any kind.
The checked-in registry (`src/lib/tag-bindings.ts`) binds demo tag `2mq2amhv` to that bed, so `/t/2mq2amhv` renders on first run; the e2e suite and the site-root redirect both key off that binding.
It is not the only binding — four of the captain's real W 171st beds (`BED-WH-1711`…`1714`) carry opaque tags there, and each of the 22 named-run ids binds its own lowercase row: 20 to the fresh run beds, and `8nhfw171`/`9nhfw171` to `BED-WH-1713`/`BED-WH-1712` beside the opaque tags those two beds already had — so read `tag-bindings.ts` rather than assuming a single demo row, or one row per bed.
The site root redirects to the demo binding **by name** (`DEMO_TAG_ID`), never to whichever row sits first: root traffic is monitors, crawlers and typed domains, and a real bed's tap count must not absorb it.
It follows that binding only while it still resolves to a LIVE bed — the demo bed is retirable from the admin like any other — and otherwise renders a calm bilingual "tap a tag to begin" screen at 200 (`ROOT` in `copy.ts`).
The demo bed is deliberately NOT made undeletable; the root is made not to depend on it, so a delete can never turn a pinned uptime check red.

**The seed holds no sign-in secret on either backend** — passwordless removed the PIN scheme entirely (its `TREEBED_SEED_PIN` seam and the live-store hash rotation with it), and the seed email is a reserved `.invalid` address, so the publicly tappable store seeds with no account anyone can open: sign-in mail to it goes nowhere real.
Live rows written under the PIN era still carry a retired `pinHash` field; it is unread, left in place because normalization is lossless, and `hasSignInRoute` is re-derived from the email instead (`normalizeData`).

If a stored value must ever be changed on the live store, the procedure is the forward revision: append a revision copying the newest one with the value replaced — do not wipe the store to re-seed it.
`scripts/rewrite-species-casing.mjs` is that shape, written down: it puts both halves of a `treeType` a store was seeded with before the door frame's casing rule into the checked-in table's own spelling, and only where the stored value is that table value modulo casing, so a name a human typed — in either language — is never rewritten.
Its output reports both decisions per field, what it changed and what it left alone, because reading the second list is how the human running it against the live store confirms the rule reached no further than casing.
It is a deliberate act a human runs (dry run by default, `--commit` to write) and never `normalizeData` behaviour — that stays additive-only, so nothing on the read path ever corrects a field a stored record already has.
It needs `NETLIFY_SITE_ID` and `NETLIFY_AUTH_TOKEN` — `@netlify/blobs` reads neither on its own — and refuses up front without them, and it needs Node >= 22.18 because it imports `.ts` modules directly.
That last one is why every one of these is TWO files: the entry checks the Node version and the credentials before anything imports a `.ts` module, and the rule itself lives in an apply module (`scripts/species-casing-rewrite.mjs`) where the tests reach it and drive it against the emulated Blobs server.
**The forward-revision procedure itself is shared, in `scripts/forward-revision.mjs`** — `commitForwardRevision` reads the newest revision (head pointer as a LOWER BOUND, forward `get`s deciding where the chain ends, exactly as `BlobsStore` does), runs the caller's change on a copy, appends `rev/<n+1>` with `onlyIfNew`, moves `head`, and re-reads on a lost race, bounded by five attempts.
It is defined once precisely because those store-walk semantics must not drift between readers, and a change that turns out to be a no-op skips the commit rather than uploading an identical dataset.
Four passes ride it today: `rewrite-species-casing.mjs`, `carry-steward.mjs`, `seed-captain-facts.mjs` and `retire-orphan-run-beds.mjs` (the last two are the operator passes this branch's deploy owes — see the named runs above, and the README for the order to run them in).
The store's name and key layout come from `src/lib/store-keys.ts` (re-exported by `store-blobs.ts`), so a remediation script can never drift onto the wrong keys.
Follow that shape for the next field a live store has to be corrected on.

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
  The mail plane adds three more runtime keys, all site-level: `BREVO_API_KEY` (secret — the org's account, being set by the captain's side; never in the repo), `TREEBED_MAIL_FROM` (the sender, `Name <address>` or a bare address), and `TREEBED_PUBLIC_ORIGIN` (the absolute origin emailed links resolve against — required, because a Host-derived origin is attacker-controlled). Unset, email sign-in says it isn't ready and the digest function no-ops loudly; nothing else is affected.
  **None of the three build-time keys is to be set with `netlify env:set`**: a site-level variable silently overrides `[build.environment]`, so a duplicate would leave this file documented as the source of truth while the site quietly won, and an edit here would have no effect on the deploy.
  The earlier site-level copies of all three have been unset accordingly.
  Checking that is itself a trap: `netlify env:list` run *inside the repo* merges `[build.environment]` into its output, so the build-time keys appear whether or not the site holds them — site-only state has to be checked from outside a checkout.
- The custom domain (`trashtalknyc.org/t/*` proxying, per ticket #5) is deliberately not wired yet; the `/b/[plate]` → `/t/[tag]` re-key landed separately and is what the site already serves.
  The bookmark cue prints `Astro.url.host` — whatever host the request arrived on — so when the proxy lands, check that the cue on door 2 and the "Adopted!" takeover prints the public domain and not the Netlify origin the proxy forwards to.

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
The retarget itself produces a run through the `edited` event, and the job reads the PR's base from the API (`repos/:repo/pulls/:number`, which is what `permissions: pull-requests: read` is there for) rather than from `github.base_ref` — a payload records the base the run was CREATED with, and a re-run replays it, so a payload-trusting check would stay red on a PR that has since been corrected.
Re-running the failed check therefore clears a retargeted PR on its own; pushing a commit is not needed, and neither is touching the check.
The payload remains the fallback for a failed API call, so a run without that permission degrades to the stale answer rather than erroring.

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
