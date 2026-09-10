**Base branch:** `dev` for feature work — it is the repository's default branch and the only branch feature work merges into.
`main` is the mirror of `prod`, so a pull request from a feature branch into `main` fails the promotion-chain check; retarget it to `dev` and the check re-runs on the new base and clears.

<!--
The base-branch note above is deliberately outside this comment: it has to survive into the
rendered pull request, because tooling that picks a base by the conventional name `main`
never reads the template at all and a human reviewer is the one who catches it.

Promotions and the hotfix path have their own valid sources — see CONTRIBUTING.md.
-->

## What this changes

## Why
