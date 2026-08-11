# NFC Tree Bed Network — agent notes

The v1 tap screen ("plaque") for Trash Talk NYC's NFC tree bed network.
A pedestrian taps a tag on a tree guard and lands on `/b/<plate>` — e.g. `/b/BED-HRL-0847`.

Source-of-truth documents live in the firstmate repo under `data/plaque-mvp-n4/`:
the approved UI prototype (`prototype/Tree Guard Plaque v2.dc.html`) is authoritative for visuals/copy/flow, and `spec.md` for product intent and rules.

## Stack

- Astro (server-rendered, `@astrojs/node` standalone adapter) + TypeScript strict.
- Requires Node >= 22 (`~/.nvm/versions/node/v22.23.1` works; the default shell Node 18.10 does not).
- `npm run dev` / `npm run build` / `npm run preview` / `npm test` (vitest) / `npm run check` (astro check).
- The plaque ships zero client JavaScript except one inline script enhancing the severity slider.
  Every form is a plain HTML POST and works with JavaScript disabled — keep it that way; the spec calls it the single most important resilience decision in the build.

## Architecture invariants

- **All persistence goes through the `Store` interface in `src/lib/store.ts`.**
  The only implementation is `src/lib/store-local.ts` (one JSON file in `.data/`, gitignored).
  Swapping to Supabase later means writing one new `Store` implementation and changing `getStore()` — nothing else.
- **Business rules live in `src/lib/service.ts`, never in the store and never in the client.**
  Two-slot cap, one-report-per-person-per-bed-per-NY-day, single open report per bed, escalate-to-dumping-once, one photo per NY week, PIN hashing.
  Anything in the browser is editable in devtools (spec §7).
- **A rule that checks state before writing it runs inside `store.transaction()`, and reads and writes through the `tx` the callback is handed — never through the store it came from.**
  A bare sequence of store calls interleaves with concurrent requests, and two reports open on one bed is unrecoverable through the UI — `closeReport` only ever finds the first.
  `tx` is a distinct object precisely so a call arriving from another request while the transaction waits on its disk write is still recognized as somebody else's and queued.
  Any new `Store` implementation must make the callback exclusive and commit or roll back its writes as a unit.
  Every mutation goes this way, including the per-tap event — a write outside the committed path can be discarded by an unrelated rollback.
- **Store reads return detached copies.** Mutating what a read handed you changes nothing; the only way to persist is an explicit write.
  This is what keeps the service layer honest against a backend that can't hand out live references.
- **`events` is append-only.** The store deliberately has no update/delete for events.
- Anonymous visitors get an HMAC-signed `tg_visitor` cookie so the daily report limit has an identity to hang on.
  Known MVP limitation: clearing cookies mints a new identity; the limit is best-effort for anonymous users.

## Security decisions (read before touching auth)

- **PIN auth is an MVP decision with a known weakness, not a considered long-term design.**
  The captain chose username + numeric PIN for the street MVP (replacing spec §2's magic-link plan).
  A 4–8 digit PIN is brute-forceable and there is no rate limiting on sign-in attempts yet.
  Revisit before any real rollout.
- PINs are bcrypt-hashed (`hashPin`/`verifyPin` in service.ts). Never store, log, or echo a plaintext PIN — the adopt form deliberately does not re-fill the PIN field on validation errors.
- `signIn` runs a bcrypt compare even when the username is unknown, so unknown-user and wrong-PIN cost the same. Don't "optimize" that short circuit back in — without rate limiting it is the only thing making username enumeration expensive.
- `TREEBED_SESSION_SECRET` is required in production; the app refuses to sign cookies with a generated one. The `.data/session-secret` fallback is dev-only.
  The requirement is checked twice so a misconfigured deploy can't reach traffic: `scripts/preflight.mjs` runs as npm's `prestart` and refuses to boot, and `src/middleware.ts` asserts at module load so a server started any other way fails on its first request of any route rather than on the first one that touches a cookie.
- Every public POST reads its body through `readCappedBody`/`readCappedForm` (`src/lib/request-body.ts`), never `request.formData()` directly — the adapter's own default limit is 1GB of buffered memory.
  A refused body is read to its end and discarded rather than cancelled: cancelling the reader destroys the socket, and a client still uploading gets a connection reset instead of the response. Only past 8× the cap is the connection dropped.
- Email and phone are PII: stored on the user record, never rendered on any public screen, never included in any client-visible payload. Only name/username is engraved, and only while `displayNameHidden` is false.

## Design tokens

- The palette in `src/styles/global.css` is the **prototype's rendered palette**, which deliberately diverges from the production site's brand tokens.
  The captain approved the prototype's look; firstmate has flagged the divergence upstream.
  Each token's comment records the brand value it diverges from — a future snap to brand palette is that one file.
- Fonts are self-hosted subsets (Nunito variable 700–900, Space Mono 400/700); provenance pinned in `public/fonts/README.md`.
  No Google Fonts CDN. Bebas Neue is intentionally absent — the prototype doesn't use it despite spec §3a.
- The bed screen's oversized action buttons are the captain's explicit override of the prototype's 66px buttons ("buttons taking close to as much of the screen as they can"). Don't shrink them back to match the prototype.
- `b/[plate]/too-large.astro` is the one screen with no prototype counterpart: where an over-cap photo upload lands.
  Filing is the core street action, so an optional attachment must never cost someone the report they already filled in — the screen carries their chosen severity and offers to file it without the photo.
  It is built from the same tokens as the rate-limited screen and, like every other screen, works with JavaScript disabled.

## Scope deliberately left out (later tasks)

- Supabase/Postgres/PostGIS, R2, any hosted service — the store swap is designed for this.
- Photo storage (the report sheet's attach affordance records only `photoAttached`), points/streak earning rules, the 1-day grace period, 311 handoff, admin dashboard, NFC tag cryptographic verification, provisioning flow.
- Streak/points on the adopter view render stored values only; nothing increments them yet.

## Seed data

One hand-seeded bed `BED-HRL-0847` (created on first boot by `store-local.ts`), with seeded adopter `marisol_r`, PIN `1234` — demo credentials for driving the sign-in flow locally.

## Branching model

The promotion chain is strict and linear:

```
feature branch -> dev -> qa -> stage -> prod
```

- `dev` is the repository's default branch and the **only** branch feature work merges into.
  Feature branches are cut from `dev` and PR back into `dev`.
- `qa` receives promotions from `dev` only.
- `stage` receives promotions from `qa` only.
- `prod` receives promotions from `stage`, plus `hotfix/*` branches as the one sanctioned exception; it is what is live.
- `main` is kept as a **mirror of `prod`** (the conventional default name pointing at what is live).
  It is never a merge target for feature work; the only valid PR into `main` comes from `prod`.

**Open every feature-work pull request against `dev`, never against `main`.**
This applies to agents and automation as much as to humans: tooling that picks a base branch by the conventional name `main` picks the wrong one here, because in this repo `main` is the prod mirror and `dev` is the default branch.
Targeting `main` from a feature branch is what a red promotion-chain check almost always means; the fix is to retarget the pull request to `dev`, not to change the check.

Forward promotion moves **up** the chain and always requires the exact predecessor, so nothing is promoted into `prod` without passing through `qa` and `stage`.
The `hotfix/*` -> `prod` exception is the one way around that, and it is trusted **by branch name alone** — the check never verifies where a `hotfix/*` branch was cut from or what it contains, so any branch named `hotfix/anything` merges straight into `prod`.
That is the deliberate cost of having a fast path at all.
Merges **down** the chain are valid by design: `prod` -> `stage` and `stage` -> `qa` are back-merges, and the check accepts them alongside each base's forward source.

Hotfix path: cut `hotfix/*` from `prod`, PR it into `prod`, then PR `prod` -> `main` to re-establish the mirror, then back-merge `prod` down through `stage`, `qa`, and `dev`.
Skipping the back-merge means the next normal promotion silently reverts the fix; skipping the `main` sync leaves `main` no longer mirroring live code.
Each of those PRs is an accepted source, so the sanctioned procedure never requires merging past a failing check.

### What CI actually does, and what it cannot do

`.github/workflows/promotion-chain.yml` **flags** a pull request into `qa`, `stage`, `prod`, or `main` whose head branch is not a valid source: it surfaces the violation as a failed check on the PR.
Valid sources per base: `qa` <- `dev` or `stage`; `stage` <- `qa` or `prod`; `prod` <- `stage` or `hotfix/*`; `main` <- `prod`.
PRs into `dev` are deliberately unchecked because feature branch names are arbitrary.

The trigger has **no `branches:` filter**; the base branch is filtered inside the script, which passes any base outside the chain.
This is load-bearing rather than stylistic.
With a `branches:` filter, retargeting a PR off a guarded base (the fix for an out-of-chain PR, e.g. `main` -> `dev`) matches no event, so no new run reports on the unchanged head SHA and the earlier failed check stays red on a PR that is now correct.
Running on every PR keeps the check an answer about the current base.

The check is **advisory only — it cannot prevent anything.**
GitHub branch protection, rulesets, and required status checks all return `403 Upgrade to GitHub Pro or make this repository public` because the Trash-Talk-NYC org is on a free plan and this repo is private.
That single limitation has three consequences:

- A red promotion-chain run leaves the merge button fully enabled.
  Anyone with write access can merge an out-of-chain PR straight past the failing check.
- Nothing observes **direct pushes** to `qa`, `stage`, `prod`, or `main`.
  The workflow only runs on pull requests.
- For `pull_request` events the workflow definition is resolved from the PR merge ref, so a head branch that deletes or renames `.github/workflows/promotion-chain.yml` produces a PR with **no** promotion-chain check at all rather than a failing one — an absent check is not proof the chain was followed.

Leaving the chain advisory is a **deliberate accepted risk** taken by the captain (small team, nothing deployed yet), not an oversight.
If the repo ever goes public or the org upgrades to a paid plan, replace this check with real branch protection / rulesets and mark it a required status check.
