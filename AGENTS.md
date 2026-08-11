# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Branching model

The promotion chain is strict and linear:

```
feature branch -> dev -> qa -> stage -> prod
```

- `dev` is the repository's default branch and the **only** branch feature work merges into.
  Feature branches are cut from `dev` and PR back into `dev`.
- `qa` receives promotions from `dev` only.
- `stage` receives promotions from `qa` only.
- `prod` receives promotions from `stage` only; it is what is live.
- `main` is kept as a **mirror of `prod`** (the conventional default name pointing at what is live).
  It is never a merge target for feature work; the only valid PR into `main` comes from `prod`.

### Enforcement and its limits

CI enforces the chain via `.github/workflows/promotion-chain.yml`, which fails any pull request into `qa`, `stage`, `prod`, or `main` whose head branch is not the correct immediate predecessor.
PRs into `dev` are deliberately unguarded because feature branch names are arbitrary.

This is the only enforcement available: GitHub branch protection and rulesets both return `403 Upgrade to GitHub Pro or make this repository public` because the Trash-Talk-NYC org is on a free plan and this repo is private.
Consequently the CI guard **cannot block direct pushes** to `qa`, `stage`, `prod`, or `main` — it only rejects out-of-chain pull requests.
If the repo ever goes public or the org upgrades to a paid plan, replace the CI guard with real branch protection / rulesets.
