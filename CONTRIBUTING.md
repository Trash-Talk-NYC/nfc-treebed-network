# Contributing

## Branching model

```
feature branch -> dev -> qa -> stage -> prod
```

`main` mirrors `prod` and is never a target for feature work.

## Day-to-day work

1. Branch from `dev` (the default branch): `git checkout -b feature/my-change origin/dev`.
2. Open your pull request against `dev`.
   That is the only branch feature work merges into.

## Promoting a release

Promote one step at a time, each via a pull request:

| Open a PR into | From |
|---|---|
| `qa` | `dev` (promotion), or `stage` (back-merge) |
| `stage` | `qa` (promotion), or `prod` (back-merge) |
| `prod` | `stage` (promotion), or a `hotfix/*` branch |
| `main` | `prod` (mirror sync) |

Promotion always requires the exact predecessor, so nothing can skip a step on the way up.
The back-merge sources travel the other way, down the chain, and exist for the hotfix path below.

CI (`promotion-chain.yml`) flags any PR into `qa`/`stage`/`prod`/`main` that comes from a branch outside that table, by failing a check on the PR.
It runs on every pull request and passes immediately for any other base, so if you opened a PR against the wrong branch, retargeting it to `dev` re-runs the check and clears it.

## Hotfix

An urgent production fix is the one sanctioned exception to the chain:

1. Cut the branch from `prod`: `git checkout -b hotfix/my-urgent-fix origin/prod`.
2. Open the pull request against `prod`.
3. **Open a PR from `prod` into `main`** to re-establish the mirror.
4. **Back-merge `prod` down through `stage`, `qa`, and `dev`**, one PR each, immediately after the hotfix lands.

Naming a branch `hotfix/*` is a real privilege: it is the only prefix that merges into `prod` without passing through `qa` and `stage`, and the check trusts the name without verifying where the branch came from.
Use it only for genuine production incidents.

Do not skip steps 3 and 4.
Step 3 exists because `main` mirrors `prod`: drop it and `main` quietly stops matching live code during an incident, which is exactly when someone will look at `main` and trust it.
Step 4 exists because if the fix only lives on `prod`, the next normal `stage` -> `prod` promotion silently reverts it.
Every PR in both steps is a supported source, so they all pass the promotion-chain check — you should never have to merge a hotfix past a red check.

## Known limitation

The CI check is **advisory — it cannot stop anyone.**
Branch protection, rulesets, and required status checks are all unavailable on this repo (free plan, private repo).
So the check marks an out-of-chain PR red, but the merge button stays enabled and anyone with write access can merge past it; it also never sees direct pushes to `qa`, `stage`, `prod`, or `main`.

Please treat a red promotion-chain check as blocking, and please don't push to those branches directly.
This is a deliberate accepted risk while the team is small and no branch deploys itself — the pilot ships by CLI from a checkout; if the repo goes public or the org upgrades, real branch protection replaces it.
