# NFC Tree Bed Network

The post-tap experience for Trash Talk NYC's NFC tree bed network.
Tap a tag on a tree guard and the bed's own state picks the screen.
A bed with no steward yet asks to be adopted; a bed that has one shows who stewards it and offers applause.
A steward is engraved as a handle and their initials — `@MapleSteward42`, `M. R.` — never as their name: the handle is generated server-side for everyone who adopts at the tag, and for a sidewalk signup written in on the admin page unless the admin deliberately types one.
A bed the admin has opened no slot on says so instead of inviting anyone — the adoption invitation is withheld on either door until a slot is offered, which is the state four of the six older W 171st tags open in, while the captain's named-run beds — and the two older beds he renamed onto N-run ids — open with their one slot already offered.
The first steward to adopt a bed gets to name it, and that name is the bed's from then on — it shows on both doors for the whole block and outlives the steward who gave it.
Any active steward can rename it afterwards from their own view, each rename recorded as an event saying who changed it, when, and to what; the block admin never authors a name and can only take one down.
Either door's second button is "this bed needs care" — thirsty plants, litter, guard damage or something else, as many as apply, with an optional photo — and both actions end on a full-screen takeover.
Applause is counted once per person per bed per day, and the first one each day tells the bed's stewards by email — at most one notice per bed per day, however many people press it, and the press itself waits on no mail.
A steward is shown the bed's own `/t/<id>` URL to bookmark — on the "Adopted!" takeover and on the door they come back to — so getting back to their bed never depends on tapping the tag again.

Every tap screen stands on solid Post No Bills Green with Poster Beige as the secondary — the ink, the buttons and the paper under the containers and picker tiles.
No colour is named anywhere but `src/lib/presentation.ts`, which returns a bed's palette, and the stylesheets read it back off `--theme-*` custom properties.

Every visitor-facing string exists in English and Spanish, with a two-state toggle the visitor operates — both languages shown, the one now speaking filled in — and no browser-language guessing; the whole flow works with JavaScript disabled.

A tag's URL is `/t/<id>`, and the ID is one of two shapes: the opaque 8-character format that carries no meaning at all, or one of the captain's own named bed ids (`1NHFW171`, `1E170171HFW`), which he deliberately asked to be readable — "it's supposed to be the url actually and the bed id" — knowing that renaming such a bed means re-encoding its chip.
Both are Crockford base32, lowercase canonical, so an ID typed off a sign still resolves and a non-canonical spelling redirects to the canonical URL.
Two of the named tags also carry a `/t/<id>/m` suffix on the chip, marking a metal guard for whoever reads the tag: it is decoration only — the route redirects it to the bare bed URL and nothing in the app reads it, because `Bed.guard` is the single source of truth for material.
Which bed the tag speaks for is a server-side fact (`src/lib/tag-bindings.ts`); the bed's plate (`BED-HRL-0847`) is the internal join key every report, adoption and event hangs on, and is never rendered — public screens key off NYC Parks' planting space ID instead.
On the named runs the plate happens to be the captain's bed id, so those are no secret, but the render rule is unchanged.

Behind a key at `/admin` is the block admin: the one surface where full names, emails and phone numbers render.
It is where a block's beds are opened for adoption one slot at a time (`Bed.offeredSlots` is a rule the adopt flow enforces, not a display state), where a steward signed up on the sidewalk is written in by hand, and where a bed's given name is taken down if it has to be.
A bed can also be added, and deleted one at a time behind a confirmation page; deleting retires the row rather than erasing it (`Bed.retiredAt`), so the plate keeps its history and a "Deleted beds" section below the street list restores it.
Adding a bed there asks only for the English species name: the Spanish one defaults from a checked-in table (`src/lib/tree-species.ts`), a typed Spanish name wins over it, and a species the table doesn't know falls back to the generic "árbol" rather than a guess — nobody has to go and look a translation up.
It is also where each bed's profile is kept: the species, the guard (none, wood or metal), whether a tree and plants are present, whether Trash Talk recommends planting, and the admin's typed notes on what is planted, what to plant and what care the bed needs.
The guard, the tree, the plants and the planting recommendation are each three-way — a bed starts at not yet recorded unless the captain has already stated the fact (as he has for the plants on `2SHFW171`, `5SHFW171` and the two beds he renamed to `8NHFW171`/`9NHFW171`), the public page then says nothing about what nobody has recorded, and a NOT RECORDED choice beside the answers is how a mis-tap goes back.
The species is the profile's one typed row, because a species is a name and not a yes/no: it takes the same English-and-optional-Spanish pair the add-bed form does, both fields arrive pre-filled so a Spanish name our own table gave the old species re-derives while one a human wrote survives the correction, and clearing the English name is the way back to not yet recorded.
A bed whose species nobody has recorded — which is how the 20 fresh named-run beds seed — still gets whole sentences on both doors, framed on the generic tree ("This tree's bed is looking for a steward."), while the About page states "not recorded" rather than guessing.
That profile is what the public "About this bed" page (`/t/<tag>/about`, a small text link under either door's buttons) states, above a network-wide FAQ and links to NYC Parks and 311.
The same panel states the bed's open report read-only — what was picked, the note, when it was opened, how many neighbours added their weight and what each of them picked and typed — so a report filed at the tag is seen there in full; closing it stays the steward's act.
The photos neighbours attach are stored and shown there too, and nowhere else: the open report's under its band, earlier reports' below it as the bed's history, and the only way one comes off is the admin deleting it behind its own confirmation page.

## Run it

Requires Node >= 22.

```sh
npm install
npm run dev            # http://localhost:4321/t/2mq2amhv — the adopted demo bed
                       # http://localhost:4321/t/jjhq9gfj — a real W 171st bed,
                       #   not open for adoption yet (see src/lib/tag-bindings.ts)
                       # http://localhost:4321/t/1nhfw171 — a captain-named run bed,
                       #   open for adoption (and /t/1nhfw171/m, the metal-guard marker)
                       # http://localhost:4321/admin — key in .data/admin-key
```

```sh
npm test               # fast suite: server-side rules and request handling (vitest)
npm run test:e2e       # builds the app and posts real bodies at a real server
npm run check          # astro type check
npm run build
npm run test:netlify-build   # builds the netlify target and boots the emitted function
TREEBED_SESSION_SECRET=<your secret> npm start   # production server
```

`TREEBED_SESSION_SECRET` is required to start the server (and to `npm run preview`, which serves the production build): cookies are signed with it, and a generated one would sign everybody out on every restart.
Generate it **once**, with `openssl rand -hex 32`, and keep that same value — in your host's secret store, out of the repo — across every restart and every instance.
Generating it inside the run command is the failure the requirement exists to prevent.
Dev needs nothing — it falls back to `.data/session-secret`.

Local state lives in `.data/store.json` (gitignored), seeded on first boot with the captain's real block — W 171st between Fort Washington and Haven, six beds `BED-WH-1711`…`1716`, each bound to its real NYC planting space, four of them unoffered until the admin page opens them and two (`BED-WH-1712`, `BED-WH-1713` — the beds he renamed onto `9NHFW171` and `8NHFW171`) already open, carrying the plant facts he stated for them — plus his three named runs of 2026-09-12: 22 named bed ids, of which 20 are fresh beds (`1E170171HFW`…`6E170171HFW` on Haven Ave, `1SHFW171`…`7SHFW171` and `1NHFW171`…`7NHFW171` on W 171st), one block per run, each seeded unasserted — no species, no NYC ids, no profile facts recorded beyond the plant facts he stated for `2SHFW171` and `5SHFW171` — and each opening with its one slot already offered.
Beside them sits the demo bed `BED-HRL-0847` and steward `marisol_r` in its own demo-flagged block; the checked-in registry (`src/lib/tag-bindings.ts`) binds demo tag `2mq2amhv` to that bed, opaque tags to four of the W 171st beds, and each named-run bed to its own lowercase id.
The other two named ids are RENAMES: standing at the beds the captain said `9NHFW171` is `BED-WH-1712` and `8NHFW171` is `BED-WH-1713`, so those ids bind to the existing plates — beside the old opaque tags, which stay live because the old URLs may already be in people's hands — and those two beds keep their species, their NYC ids and their history.
Which run beds the remaining four older W 171st beds are is still unsaid, so they keep their own ids and records until he stands at the tree and names them.
Sign-in is passwordless: the steward asks for a link at `/t/<tag>/auth` with the email they adopted with, and with no `BREVO_API_KEY` configured the mail lands as a JSON file in `.data/outbox/` — open the link inside it and press its one SIGN IN button to sign in locally (the seeded steward's email is `seed-marisol@example.invalid`; opening the link alone spends nothing, because mail scanners prefetch links).
The site root redirects to the demo binding by name, so monitors and crawlers hitting `/` never land on a real bed — and only while that binding still names a live bed, so retiring the demo bed (or a store that can't be read) leaves a calm bilingual screen at 200 rather than turning a pinned uptime check red.
The checked-in blocks and beds also backfill into an already-seeded store on its next load, insert-only, so a live store gains them without a migration step.
Care photos are stored beside that file in `.data/photos/` (their own blobs on Netlify), outside the dataset itself, because every commit rewrites the dataset whole.
Delete `.data/` to reset.
`TREEBED_DATA_DIR` puts that directory — the store and the dev session secret both — somewhere else; the end-to-end suite uses it to give every server it spawns a fresh one.

Two environment variables pick what the app is built and run as, and both default to the local development answer.
`TREEBED_STORE` selects the backend behind the one `Store` interface: `local` (unset or `local`) is the JSON file above; `blobs` is Netlify Blobs, what the deployed pilot runs.
`TREEBED_ADAPTER` selects the build target: `node` (the default) is the standalone server `npm start`, `npm run preview` and the end-to-end suite use; `netlify` emits Netlify Functions and is what `netlify.toml` sets for every Netlify build.

`TREEBED_ADMIN_KEY` is the block admin's whole gate — one long random key (`openssl rand -hex 32`), no username, no typed account secret.
Where no key is configured, every `/admin` route answers 404, so a deploy that never set one has no admin surface at all; `npm start` and `npm run preview` say so in one line before binding the port.
Dev needs nothing here either: it generates a key into `.data/admin-key` on first use.
The session it opens is a signed `tg_admin` cookie lasting 30 days, and every admin screen carries a sign-out control, because that cookie opens contact details on a phone that gets handed around.

See `AGENTS.md` for architecture invariants, security decisions, and what is deliberately out of scope.

## Deploy

The pilot is live at <https://treebed-plaque.netlify.app/t/2mq2amhv>, on the Netlify site `treebed-plaque` (site id `449a9585-ae51-4e23-9614-fe5b3ac669f1` — never the org's `trashtalknyc` site, which is a different product).
Deploys are CLI-driven from a checkout on Node >= 22 rather than repo-linked, so no branch deploys itself:

```sh
NETLIFY_SITE_ID=449a9585-ae51-4e23-9614-fe5b3ac669f1 npx netlify-cli@latest deploy --build --prod
```

`netlify.toml` is the sole source for the build-time environment (`TREEBED_ADAPTER`, `NODE_VERSION`, `AWS_LAMBDA_JS_RUNTIME`); the site's own environment carries only the runtime keys — `TREEBED_SESSION_SECRET`, `TREEBED_STORE=blobs`, `TREEBED_ADMIN_KEY`, and the mail plane's three: `BREVO_API_KEY`, `TREEBED_MAIL_FROM`, `TREEBED_PUBLIC_ORIGIN`.
Don't set the build-time three with `netlify env:set` — a site-level variable silently overrides this file.
`TREEBED_ADMIN_KEY` is what gives a deployed site an admin at all; the pilot has held one since 2026-09-10, and where it is unset `/admin` stays a 404.
Like the session secret it belongs in the site's own environment, never in `netlify.toml` — a key checked into the repo is a published one.
Where the mail keys are unset, email sign-in says it isn't ready and the daily scheduled function (`netlify/functions/digest.mts`) no-ops with a log line; the digest also stays silent until the block admin turns its cadence on — it ships defaulted to off.
That same daily run delivers the applause notices a press queued, which do not wait on the digest cadence: they are a different mail, and a notice stays queued rather than burnt while mail is unconfigured.
The seed holds no sign-in secret on any backend: the seeded steward's `.invalid` email can receive no link, so nothing opens that account on the deployed site.

A field a live store was written with before a rule existed is corrected by appending a forward revision, never by wiping and re-seeding.
`scripts/rewrite-species-casing.mjs` is that shape written down — it puts both halves of a bed's species into the casing the checked-in table authors ("willow oak", but "Norway maple"; Spanish always lowercase), and only where the stored value is that table value modulo casing, so a name a human typed in either language is left byte-for-byte.
Its output reports what it changed *and* what it left alone, because reading the second list is how whoever runs it confirms the rule reached no further than casing.
It is a deliberate act a human runs on Node >= 22.18, dry by default:

```sh
NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/rewrite-species-casing.mjs            # prints what would change
NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/rewrite-species-casing.mjs --commit   # writes the revision
```

`scripts/carry-steward.mjs` is the same shape for the day the captain says which named-run bed one of the six older W 171st records actually is: it releases the adoption on the old plate and recreates it on the new one keeping its original `adoptedAt`, moves nothing else — reports, events and the bed's given name stay keyed where they were written — and is reversible by swapping `--from` and `--to`.
It applies the checked-in records first, so a run bed no commit has persisted yet is still found.

```sh
NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/carry-steward.mjs \
  --user marisol_r --from BED-WH-1711 --to 5SHFW171        # add --commit to write
```

Two of these passes are owed by THIS branch's deploy, because seeding is insert-only and the captain's rename arrived after PR #29 had already written to the live store.
Run them in this order, dry first:

```sh
NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/seed-captain-facts.mjs       # add --commit to write
NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/retire-orphan-run-beds.mjs   # add --commit to write
```

`scripts/seed-captain-facts.mjs` puts the captain's stated plant facts on the existing `BED-WH-1712`/`BED-WH-1713` rows the named ids `8NHFW171`/`9NHFW171` now open — it fills only fields still reading NOT RECORDED, so the admin's own unrecord radio keeps sticking, and a field the seed itself does not assert is left alone.
`scripts/retire-orphan-run-beds.mjs` retires the two blank rows PR #29 seeded under those plates before the rename, which no tag reaches now.
It refuses a row still holding an ACTIVE adoption and says so: run `scripts/carry-steward.mjs` on that row first, then re-run this one — the carry's leftover released adoption does not refuse, and the retire's report line names everything the tombstone still holds.

## Contributing

Branches follow a strict promotion chain:

```
feature branch -> dev -> qa -> stage -> prod
```

`dev` is the default branch and the only target for feature work; `main` mirrors `prod`.
A CI check (`.github/workflows/promotion-chain.yml`) flags pull requests into `qa`, `stage`, `prod`, or `main` that come from outside the chain, but it is advisory and cannot block a merge.

See [CONTRIBUTING.md](CONTRIBUTING.md) for where to branch from, how to promote, and the hotfix path.
