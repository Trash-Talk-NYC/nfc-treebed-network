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
npm test               # server-side rule tests (vitest)
npm run check          # astro type check
npm run build && TREEBED_SESSION_SECRET=$(openssl rand -hex 32) npm start   # production server
```

`TREEBED_SESSION_SECRET` is required to start the server: cookies are signed with it, and a generated one would sign everybody out on every restart.
Set the same value on every instance, and keep it out of the repo.
Dev needs nothing — it falls back to `.data/session-secret`.

Local state lives in `.data/store.json` (gitignored), seeded on first boot with the one demo bed `BED-HRL-0847` and adopter `marisol_r` (PIN `1234`).
Delete `.data/` to reset.

See `AGENTS.md` for architecture invariants, security decisions, and what is deliberately out of scope.

## Contributing

Branches follow a strict promotion chain:

```
feature branch -> dev -> qa -> stage -> prod
```

`dev` is the default branch and the only target for feature work; `main` mirrors `prod`.
A CI check (`.github/workflows/promotion-chain.yml`) flags pull requests into `qa`, `stage`, `prod`, or `main` that come from outside the chain, but it is advisory and cannot block a merge.

See [CONTRIBUTING.md](CONTRIBUTING.md) for where to branch from, how to promote, and the hotfix path.
