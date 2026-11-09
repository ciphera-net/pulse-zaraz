# Releasing pulse-zaraz

## 🔴 There is no central "release" for this component — read this first

Every other public Pulse integration has one publish step this team runs once
(an npm publish, a wordpress.org SVN commit, a TER `tailor ter:publish`), after
which every customer's install picks it up. **A Custom Managed Component does
not work that way.** Each site owner who wants it:

1. clones or downloads this repo,
2. runs `npm run build` themselves,
3. runs `npx managed-component-to-cloudflare-worker ./dist/index.js
   pulse-analytics` themselves, which deploys a Worker **into their own
   Cloudflare account** — never ours,
4. adds it in **their own** Zaraz dashboard.

There is no account or credential of ours involved in a customer's install at
all. "Releasing" this repo means making a good version available at a stable
place for them to build from — it does not mean anything gets deployed by us,
anywhere, to anyone.

## What a release actually is

1. Tag a version in this repo (`git tag vX.Y.Z`) once `npm run build` is
   green. CI runs the same checks on every pull request (see "CI" below).
2. Nothing is published to npm, GitHub Packages or any other registry. The
   component is deployed from **source**, per the install steps above, using
   `managed-component-to-cloudflare-worker` directly against the built file —
   the same way `simpleanalytics/zaraz-integration` and
   `mountainash/posthog-managed-component` are installed. There is nothing to
   `npm publish`; doing so would just make an unused package sit in a
   registry.
3. (Optional, discoverability only) **Submit a PR to
   `managed-components/docs`**, adding this component's GitHub URL to the
   "Community Managed Components" list in `src/pages/components.md` —
   rendered at <https://managedcomponents.dev/components>. This is how
   PostHog's and Simple Analytics' components are listed; it costs one line
   in one file.
   - **Credential needed:** a GitHub account that can fork
     `managed-components/docs` and open a PR. No CLA was found in that repo
     (checked: no `CONTRIBUTING.md`, no CLA-bot workflow) — unlike the
     Docusaurus integration, which needs a signed Meta CLA for its listing PR.
   - **What gets reviewed:** nothing automated — the merged precedent
     (`managed-components/docs#10`, the PostHog listing) is a **5-line diff**
     adding one list entry, merged the same day it was opened. Expect a
     maintainer glance, not a technical review: this is a docs list, not the
     curated tools catalogue.
   - This PR does **not** get Pulse into Cloudflare's own curated Zaraz tools
     catalogue (the ~29-repo list Cloudflare ships inside the dashboard's
     built-in search). Getting into that list is Cloudflare's call; there is
     no documented submission path for it, and the strategy doc
     (`Pulse/docs/plans/14-09-2026-integration-marketplaces-strategy.md`,
     §5) records the catalogue as "Cloudflare-curated" for exactly this
     reason. Nothing in this repo should promise a customer "search for Pulse
     in your Zaraz tools list" — the honest instruction is the Custom
     Managed Component path in README.md.

## CI

Since 09-11-2026 Woodpecker runs the security scan and what `npm run build`
runs locally (`tsc --noEmit`, `vitest run`, the esbuild bundle) on every pull
request and push to `main`. There is no deploy step, because nothing here is
deployed (see above).

## Verifying a built release

`scripts/verify.sh` is the real-install harness (see its header comment and
README.md's "Testing" section for what it asserts). It needs Docker. 🟢 It
has now been run for real: all 7 real-install cases pass, `--mutate` goes
red exactly where intended (and a plain run is green again straight after),
and 33/33 unit tests pass both locally and inside the Docker build step.
Four first-run defects in the harness itself were found and fixed along the
way — none were defects in the component (see README.md's "Testing" for the
list, and the real shipped `<script>` bytes a real browser built). `npm run
build` (typecheck + unit tests + bundle) passes on its own too.

Still unverified, and out of reach without owner-provided credentials: a
real Cloudflare account with Zaraz enabled, and the
`managed-component-to-cloudflare-worker` conversion step specifically (the
verify harness drives WebCM's own dev server, not a deployed Worker). See
README.md's "Open risks and unverified claims".

## Trademark

Cloudflare, Cloudflare Workers and Zaraz are trademarks of Cloudflare, Inc. No
submission under this process asks Cloudflare for a name or logo licence —
the Custom Managed Component path and the community-docs PR are both
third-party, unreviewed-by-Cloudflare surfaces, and nothing here uses a
Cloudflare mark (see LISTING.md).
