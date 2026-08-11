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
| `prod` | `stage` |
| `main` | `prod` (mirror sync) |

CI (`promotion-chain.yml`) fails any PR into `qa`/`stage`/`prod`/`main` that comes from the wrong branch.

## Known limitation

Branch protection is unavailable on this repo (free plan, private repo), so the CI check only guards pull requests.
It cannot block a direct push to `qa`, `stage`, `prod`, or `main` — please don't push to those branches directly.
