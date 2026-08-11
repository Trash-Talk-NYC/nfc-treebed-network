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
| `qa` | `dev` |
| `stage` | `qa` |
| `prod` | `stage`, or a `hotfix/*` branch |
| `main` | `prod` (mirror sync) |

CI (`promotion-chain.yml`) flags any PR into `qa`/`stage`/`prod`/`main` that comes from the wrong branch, by failing a check on the PR.

## Hotfix

An urgent production fix is the one sanctioned exception to the chain:

1. Cut the branch from `prod`: `git checkout -b hotfix/my-urgent-fix origin/prod`.
2. Open the pull request against `prod`.
3. **Back-merge `prod` down through `stage`, `qa`, and `dev`**, one PR each, immediately after the hotfix lands.

Do not skip step 3.
If the fix only exists on `prod`, the next normal `stage` -> `prod` promotion silently reverts it.

## Known limitation

The CI check is **advisory — it cannot stop anyone.**
Branch protection, rulesets, and required status checks are all unavailable on this repo (free plan, private repo).
So the check marks an out-of-chain PR red, but the merge button stays enabled and anyone with write access can merge past it; it also never sees direct pushes to `qa`, `stage`, `prod`, or `main`.

Please treat a red promotion-chain check as blocking, and please don't push to those branches directly.
This is a deliberate accepted risk while the team is small and nothing is deployed; if the repo goes public or the org upgrades, real branch protection replaces it.
