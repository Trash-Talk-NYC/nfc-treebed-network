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
TREEBED_SESSION_SECRET=<your secret> npm start   # production server
```

`TREEBED_SESSION_SECRET` is required to start the server (and to `npm run preview`, which serves the production build): cookies are signed with it, and a generated one would sign everybody out on every restart.
Generate it **once**, with `openssl rand -hex 32`, and keep that same value — in your host's secret store, out of the repo — across every restart and every instance.
Generating it inside the run command is the failure the requirement exists to prevent.
Dev needs nothing — it falls back to `.data/session-secret`.

Local state lives in `.data/store.json` (gitignored), seeded on first boot with the one demo bed `BED-HRL-0847` and adopter `marisol_r` (PIN `1234`).
Delete `.data/` to reset.
`TREEBED_DATA_DIR` puts that directory — the store and the dev session secret both — somewhere else; the end-to-end suite uses it to give every server it spawns a fresh one.

See `AGENTS.md` for architecture invariants, security decisions, and what is deliberately out of scope.

## Contributing

Branches follow a strict promotion chain:

```
feature branch -> dev -> qa -> stage -> prod
```

`dev` is the default branch and the only target for feature work; `main` mirrors `prod`.
A CI check (`.github/workflows/promotion-chain.yml`) flags pull requests into `qa`, `stage`, `prod`, or `main` that come from outside the chain, but it is advisory and cannot block a merge.

See [CONTRIBUTING.md](CONTRIBUTING.md) for where to branch from, how to promote, and the hotfix path.
