# NFC Tree Bed Network

The tap screen ("plaque") for Trash Talk NYC's NFC tree bed network.
Tap a tag on a tree guard, get that bed's plaque: its plate, who adopted it, its condition, and two actions — report litter, or claim an open adopter slot.

## Run it

Requires Node >= 22.

```sh
npm install
npm run dev            # http://localhost:4321/b/BED-HRL-0847
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

Local state lives in `.data/store.json` (gitignored), seeded on first boot with the one demo bed `BED-HRL-0847` and adopter `marisol_r` (PIN `1234`).
Delete `.data/` to reset.
`TREEBED_DATA_DIR` puts that directory — the store and the dev session secret both — somewhere else; the end-to-end suite uses it to give every server it spawns a fresh one.

Two environment variables pick what the app is built and run as, and both default to the local development answer.
`TREEBED_STORE` selects the backend behind the one `Store` interface: `local` (unset or `local`) is the JSON file above; `blobs` is Netlify Blobs, what the deployed pilot runs.
`TREEBED_ADAPTER` selects the build target: `node` (the default) is the standalone server `npm start`, `npm run preview` and the end-to-end suite use; `netlify` emits Netlify Functions and is what `netlify.toml` sets for every Netlify build.

See `AGENTS.md` for architecture invariants, security decisions, and what is deliberately out of scope.

## Deploy

The pilot is live at <https://treebed-plaque.netlify.app/b/BED-HRL-0847>, on the Netlify site `treebed-plaque` (site id `449a9585-ae51-4e23-9614-fe5b3ac669f1` — never the org's `trashtalknyc` site, which is a different product).
Deploys are CLI-driven from a checkout on Node >= 22 rather than repo-linked, so no branch deploys itself:

```sh
NETLIFY_SITE_ID=449a9585-ae51-4e23-9614-fe5b3ac669f1 npx netlify-cli@latest deploy --build --prod
```

`netlify.toml` is the sole source for the build-time environment (`TREEBED_ADAPTER`, `NODE_VERSION`, `AWS_LAMBDA_JS_RUNTIME`); the site's own environment carries only the runtime keys, `TREEBED_SESSION_SECRET` and `TREEBED_STORE=blobs`.
Don't set the build-time three with `netlify env:set` — a site-level variable silently overrides this file.
The Blobs store seeds `marisol_r` with a PIN nobody knows, so the `1234` above is a local convenience and never a way in to the deployed site.

## Contributing

Branches follow a strict promotion chain:

```
feature branch -> dev -> qa -> stage -> prod
```

`dev` is the default branch and the only target for feature work; `main` mirrors `prod`.
A CI check (`.github/workflows/promotion-chain.yml`) flags pull requests into `qa`, `stage`, `prod`, or `main` that come from outside the chain, but it is advisory and cannot block a merge.

See [CONTRIBUTING.md](CONTRIBUTING.md) for where to branch from, how to promote, and the hotfix path.
