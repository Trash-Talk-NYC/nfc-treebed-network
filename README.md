# NFC Tree Bed Network

The post-tap experience for Trash Talk NYC's NFC tree bed network.
Tap a tag on a tree guard and the bed's own state picks the screen.
A bed with no steward yet asks to be adopted; a bed that has one shows who stewards it and offers applause.
A bed the admin has opened no slot on says so instead of inviting anyone — the adoption invitation is withheld on either door until a slot is offered, which is the state the W 171st tags open today.
Either door's second button is "this bed needs care" — thirsty plants, litter, guard damage or something else, as many as apply, with an optional photo — and both actions end on a full-screen takeover.

Every visitor-facing string exists in English and Spanish, with a two-state toggle the visitor operates — both languages shown, the one now speaking filled in — and no browser-language guessing; the whole flow works with JavaScript disabled.

A tag's URL is `/t/<id>` — an opaque 8-character ID that carries no meaning at all.
Which bed the tag speaks for is a server-side fact (`src/lib/tag-bindings.ts`); the bed's plate (`BED-HRL-0847`) is the internal join key every report, adoption and event hangs on, and is never rendered — public screens key off NYC Parks' planting space ID instead.

Behind a key at `/admin` is the block admin: the one surface where full names, emails and phone numbers render.
It is where a block's beds are opened for adoption one slot at a time (`Bed.offeredSlots` is a rule the adopt flow enforces, not a display state), where the guard's ordered/installed dates are flipped, and where a steward signed up on the sidewalk is written in by hand.
Adding a bed there asks only for the English species name: the Spanish one defaults from a checked-in table (`src/lib/tree-species.ts`), a typed Spanish name wins over it, and a species the table doesn't know falls back to the generic "árbol" rather than a guess — nobody has to go and look a translation up.

## Run it

Requires Node >= 22.

```sh
npm install
npm run dev            # http://localhost:4321/t/2mq2amhv — the adopted demo bed
                       # http://localhost:4321/t/jjhq9gfj — a real W 171st bed,
                       #   not open for adoption yet (see src/lib/tag-bindings.ts)
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

Local state lives in `.data/store.json` (gitignored), seeded on first boot with the captain's real block — W 171st between Fort Washington and Haven, six beds `BED-WH-1711`…`1716`, each bound to its real NYC planting space and all unoffered until the admin page opens them — plus the demo bed `BED-HRL-0847` and steward `marisol_r` (PIN `1234`) in its own demo-flagged block; the checked-in registry (`src/lib/tag-bindings.ts`) binds demo tag `2mq2amhv` to that bed and real tags to four of the W 171st beds.
The site root redirects to the demo binding by name, so monitors and crawlers hitting `/` never land on a real bed.
The checked-in blocks and beds also backfill into an already-seeded store on its next load, insert-only, so a live store gains them without a migration step.
Delete `.data/` to reset.
`TREEBED_DATA_DIR` puts that directory — the store and the dev session secret both — somewhere else; the end-to-end suite uses it to give every server it spawns a fresh one.

Two environment variables pick what the app is built and run as, and both default to the local development answer.
`TREEBED_STORE` selects the backend behind the one `Store` interface: `local` (unset or `local`) is the JSON file above; `blobs` is Netlify Blobs, what the deployed pilot runs.
`TREEBED_ADAPTER` selects the build target: `node` (the default) is the standalone server `npm start`, `npm run preview` and the end-to-end suite use; `netlify` emits Netlify Functions and is what `netlify.toml` sets for every Netlify build.

`TREEBED_ADMIN_KEY` is the block admin's whole gate — one long random key (`openssl rand -hex 32`), no username, no PIN.
Unset in production, every `/admin` route answers 404, so a deploy that never configured a key has no admin surface at all; `npm start` and `npm run preview` say so in one line before binding the port.
Dev needs nothing here either: it generates a key into `.data/admin-key` on first use.
The session it opens is a signed `tg_admin` cookie lasting 30 days, and every admin screen carries a sign-out control, because that cookie opens contact details on a phone that gets handed around.

See `AGENTS.md` for architecture invariants, security decisions, and what is deliberately out of scope.

## Deploy

The pilot is live at <https://treebed-plaque.netlify.app/t/2mq2amhv>, on the Netlify site `treebed-plaque` (site id `449a9585-ae51-4e23-9614-fe5b3ac669f1` — never the org's `trashtalknyc` site, which is a different product).
Deploys are CLI-driven from a checkout on Node >= 22 rather than repo-linked, so no branch deploys itself:

```sh
NETLIFY_SITE_ID=449a9585-ae51-4e23-9614-fe5b3ac669f1 npx netlify-cli@latest deploy --build --prod
```

`netlify.toml` is the sole source for the build-time environment (`TREEBED_ADAPTER`, `NODE_VERSION`, `AWS_LAMBDA_JS_RUNTIME`); the site's own environment carries only the runtime keys, `TREEBED_SESSION_SECRET` and `TREEBED_STORE=blobs`.
Don't set the build-time three with `netlify env:set` — a site-level variable silently overrides this file.
`TREEBED_ADMIN_KEY` is a runtime key too, and setting it is what gives the deployed site an admin at all; leave it unset and `/admin` stays a 404.
Like the session secret it belongs in the site's own environment, never in `netlify.toml` — a key checked into the repo is a published one.
The Blobs store seeds `marisol_r` with a PIN nobody knows, so the `1234` above is a local convenience and never a way in to the deployed site.
`TREEBED_SEED_PIN` is the development-only seam for driving sign-in against a local `blobs` store; a netlify build ignores it however it is set, so it can never open the deployed one.

A field a live store was written with before a rule existed is corrected by appending a forward revision, never by wiping and re-seeding.
`scripts/rewrite-species-casing.mjs` is that shape written down — it lowercases the Spanish species names the pilot store was seeded with, and only where the stored value is the checked-in table's own modulo casing, so a name a human typed is left alone.
It is a deliberate act a human runs on Node >= 22.18, dry by default:

```sh
NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/rewrite-species-casing.mjs            # prints what would change
NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/rewrite-species-casing.mjs --commit   # writes the revision
```

## Contributing

Branches follow a strict promotion chain:

```
feature branch -> dev -> qa -> stage -> prod
```

`dev` is the default branch and the only target for feature work; `main` mirrors `prod`.
A CI check (`.github/workflows/promotion-chain.yml`) flags pull requests into `qa`, `stage`, `prod`, or `main` that come from outside the chain, but it is advisory and cannot block a merge.

See [CONTRIBUTING.md](CONTRIBUTING.md) for where to branch from, how to promote, and the hotfix path.
