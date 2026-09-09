<!--
Base branch: `dev`.

Feature work always targets `dev` — it is the repository's default branch and the only
branch feature work merges into. `main` is the mirror of `prod`, so a pull request from a
feature branch into `main` fails the promotion-chain check; retarget it to `dev` and the
check re-runs on the new base and clears.

Promotions and the hotfix path have their own valid sources — see CONTRIBUTING.md.
-->

## What this changes

## Why
