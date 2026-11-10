# Pulse Analytics for Cloudflare Zaraz

This Managed Component adds privacy-first analytics to a site that uses
Cloudflare Zaraz. Pulse Analytics sets no cookies and never stores IP addresses,
and the script it adds to your pages is under 3 KB.

[Pulse Analytics](https://pulse.ciphera.net) is built by
[Ciphera](https://ciphera.net), a company in Belgium, and hosted in
Switzerland.

## What this is, precisely

This is a [Managed Component](https://managedcomponents.dev) that puts the real
Pulse tracker on your pages. Managed Components are defined by the open
`managed-components` spec, which Cloudflare Zaraz implements. This one is not in
Cloudflare's curated Zaraz tools catalogue. Cloudflare curates that list, which
holds roughly 29 repos, and decides what gets into it, so a submission cannot
force an entry.

It is a Custom Managed Component: you build it, deploy it as a Cloudflare Worker
in your own Cloudflare account, and add it from Zaraz's
"Add new tool → Custom Managed Component" screen. Every community-built Managed
Component reaches Zaraz this way today, including the PostHog one, the Snowplow
one and this one.

## Requirements

- A zone on Cloudflare with Zaraz enabled.
- A Cloudflare account you can deploy a Worker to (`wrangler login`).
- Node.js to build this repo. The built component needs nothing at runtime and
  has zero npm dependencies. Only `@managed-components/types` is a type-only,
  build-time dependency, and it does not appear in the bundle (checked below).
- A Pulse Analytics account with a site registered for the domain you'll
  configure. The free plan is enough to start.

## Install

1. Build the component:
   ```bash
   npm install
   npm run build        # typecheck, test, then bundle to dist/index.js
   ```
2. Deploy it as a Worker in your own Cloudflare account:
   ```bash
   npx wrangler login
   npx managed-component-to-cloudflare-worker ./dist/index.js pulse-analytics
   ```
   This creates a Worker named `custom-mc-pulse-analytics` in your account.
3. In the Cloudflare dashboard: **Zaraz → Tools Configuration → Third-party
   tools → Add new tool → Custom Managed Component**, then pick
   `custom-mc-pulse-analytics` from the list.
4. Grant permissions. This component asks for exactly one,
   `execute_unsafe_scripts`. The "Permissions" section below explains why.
5. Configure the settings. Name the tool "Pulse Analytics" and set `domain` to
   the domain this site is registered under in Pulse. For a site served on one
   domain, leave it empty and the tracker uses the browser's own hostname. See
   "What the Zaraz dashboard renders" below before you look for a
   dropdown or a checkbox here.
6. Add a Trigger. Every Zaraz tool, built-in or custom, runs only when a
   Trigger tells it to. The default "Pageview" trigger, which covers all page
   loads, is the right one for Pulse. Setting up the built-in "Custom HTML" tool
   needs the same step, so using a Managed Component adds no extra cost.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `domain` | empty | The domain this site is registered under in Pulse. Empty means auto-detect. |
| `companion` | `false` | Enter `true` to also load the companion script, which records clicks, copies and form submits. It loads in a second, separate request (see below). |
| `api` | empty | Route events through your own proxy origin. Enter the origin only, without a path. |

### What the Zaraz dashboard renders for a Custom Managed Component

`manifest.json` declares these settings as typed `fields`, per the
[Managed Components manifest spec](https://managedcomponents.dev/specs/manifest/options).
But the firsthand account from the one community analytics component with a
written-up install (the
[PostHog Managed Component](https://github.com/mountainash/posthog-managed-component),
21 stars, Apache-2.0) describes a Custom Managed Component's Settings screen as
a plain key/value editor. Its install steps say "Click the first **Add Field**
button… Add a new custom field named `POSTHOG_API_KEY`". That does not match
the typed form the spec implies. The officially curated tools (Google Analytics
4, Mixpanel) declare no top-level `fields` in their manifests at all, which
suggests Cloudflare renders their settings UI from something else, outside the
open manifest. We have not driven a real Zaraz dashboard to confirm this
ourselves (see "Open risks and unverified claims" below).

`manifest.json`'s `fields` array is kept as documentation of the three settings
and their defaults. The component's own code (`isTruthy()`) is written
defensively, so a `companion` value typed as the literal text `true` works
exactly like a real boolean, because the dashboard is reported to take free
text.

## Why client-side injection instead of server-side forwarding

Zaraz's own generic client-side runtime already captures a `pageview` event
and hands it to every configured component on the server. The established
pattern for a Managed Component built on an existing ingestion API (Google
Analytics 4's Measurement Protocol, PostHog's `/capture/` endpoint, Snowplow's
collector) is to forward that event server-side. The Worker reads `client.ip`,
`client.userAgent`, `client.url` and so on, builds that API's request shape, and
calls it with `manager.fetch()`. The browser never loads the vendor's own
tracker.

That shape does not fit Pulse. Building it would mean reimplementing a
meaningful share of what the real tracker does, with a real chance of the two
drifting apart:

- Pulse has no server-to-server ingestion endpoint built for this, by design.
  The public surface of `pulse-api.ciphera.net` is the aggregates-only Read API,
  and the ingestion path the tracker posts to expects exactly what the tracker
  computes client-side.
- The privacy behaviour lives in the tracker's own JavaScript. Do Not Track and
  Global Privacy Control are read from the browser, engaged time is measured
  from real visibility and input events rather than wall-clock time, and scroll
  depth comes from the real viewport. None of that exists in Zaraz's generic
  `pageview` payload, so a server-side re-implementation would have to guess at
  all of it from request metadata. It is the "two surfaces disagreeing about
  what gets measured" class of defect that this codebase has been bitten by
  before (daily-stats drift and visitor-identity drift: different features, same
  lesson).
- Visitor identity is derived server-side, from the real request the tracker
  itself makes. It does not come from a cookie Zaraz could mint on the tracker's
  behalf, and a generic Managed Components `Client` object cannot reproduce it.

The closest real-world precedent made the same choice. Simple Analytics, a
cookieless, privacy-first analytics competitor, publishes its own official Zaraz
component
([`simpleanalytics/zaraz-integration`](https://github.com/simpleanalytics/zaraz-integration)).
Its default `pageview` path has exactly this shape:
`event.client.execute(createScript(settings))`, appending its own
`<script src="https://scripts.simpleanalyticscdn.com/latest.js">` to
`document.head`. It also offers an opt-in `pageviewTracking: "server"` mode that
switches to forwarding via `manager.fetch()` instead. So the ecosystem's own
privacy-first vendor treats client-side injection as the default and
server-side forwarding as the alternative. GA4, PostHog and Snowplow (ad-tech
and general-purpose analytics, where "the browser never talks to the vendor" is
the whole point) put the emphasis the other way round. Pulse has no server-side
ingestion endpoint built for a mode like that, so this component does not offer
one. See below for what that costs.

This component therefore does what the Astro integration does, for the same
underlying reason (see `pulse-astro`'s README, "View-source shows a bootstrap,
not a `<script src>` tag"). It builds the exact tracker tag in the DOM via
`client.execute()`, and from that point on the real tracker, the identical file
every other Pulse install loads, runs as it does everywhere else. It also
borrows Simple Analytics' own double-injection guard, which skips `add()` if a
script with that `src` is already on the page (see `buildBootstrap` in
`src/pulse.ts`). The trade-off has two sides:

- Compared with server-side forwarding, this keeps Pulse's privacy model
  (DNT/GPC, engaged time, scroll depth, server-side identity derivation)
  byte-for-byte the same as every other install. Nothing on Pulse's side
  changes, and the dashboard numbers mean the same thing on a Zaraz site as on a
  WordPress or Next.js one.
- It does not give you Zaraz's "server-side first-party delivery", the thing
  that makes the GA4, PostHog and Snowplow components arguably more private or
  CSP-friendly than a pasted `<script src>` tag, because the browser never talks
  to the vendor directly. Once this component's bootstrap runs, the tracker
  makes its own requests to `js.ciphera.net` and `pulse-api.ciphera.net`
  directly from the browser, like a pasted tag does. Zaraz is not in that path
  and cannot see or control it.

## What lands on the page

Zaraz never puts a literal `<script>` tag into the HTML Cloudflare serves, which
is the point of the Managed Components model (see "What this is, precisely"
above). The tag exists in the DOM only after Zaraz's own client-side runtime has
loaded and told the server "this is a pageview", and the server has replied with
the JavaScript this component queued up via `client.execute()`. View-source of
the page shows Zaraz's own loader script, and it never shows the Pulse tag
directly. This is the same structural fact as the Astro integration's inline
bootstrap, one level further removed. Once that JavaScript runs, the DOM holds
exactly:

```html
<script defer data-domain="example.com" data-api="https://proxy.example.com" src="https://js.ciphera.net/script.js"></script>
```

(`data-api` appears only when the `api` setting is configured.) With the
companion setting on, a second
`<script defer src="https://js.ciphera.net/script.interactions.js"></script>`
is also appended. It carries no `data-domain` or `data-api` of its own: the
tracker resolves both once, from the core script, and a second copy of either
would be a second thing to keep in step.

The `api` setting ships as a `data-api` attribute on the core script element,
the same way `data-domain` does. This matches the Drupal, Joomla and TYPO3
integrations' `TagBuilder` exactly, and it differs from the `window.pulseConfig`
global the Astro integration uses for the same setting. The choice is
deliberate: this component already builds the element with `setAttribute()` for
`data-domain`, so a second attribute is simpler than a separate global, and it
agrees with three of our four other platform integrations instead of one.

An invalid domain is dropped and never injected. Unlike the Astro integration,
which can afford to fail a build on a bad explicit domain, this component runs
inside Zaraz's shared per-pageview execution, where throwing would break the
page instead of failing a build somebody is looking at. So a domain that cannot
be a hostname is silently treated as unset, which leaves a working install one
attribute short. The Drupal, Joomla and TYPO3 integrations make the same choice.

### Why this listens to `pageview` and ignores `historyChange`

Simple Analytics' component also re-runs `createScript()` on Zaraz's
client-side `historyChange` event, to cover single-page-app soft navigation.
This component deliberately does not. Pulse's real tracker already detects a
path change and counts it as a new pageview on its own once it is loaded, which
is the same reason the Astro integration injects once and stops. Re-invoking the
bootstrap on every soft navigation would do nothing (the double-injection guard
above makes it a no-op) except spend a round trip to Zaraz's server on every
in-app navigation for no benefit.

## When this is worth it over Zaraz's free "Custom HTML" tool

Every Zaraz user can already paste the literal tag above into Zaraz's built-in
"Custom HTML" tool, for free, with no Worker to deploy. This component does not
change what ends up running: it is the same tag and the same tracker. What it
changes:

- The domain is a typed, named setting instead of a hand-edited string. It lives
  in a field called `domain` and is validated by this component's own code
  before it is interpolated into JavaScript. In a block of pasted HTML, a typo
  is just as easy to make and much easier to miss.
- This component declares what its permission is for. Custom HTML's permission
  in Zaraz is `execute_unsafe_scripts` with no description of what the HTML
  does. Zaraz cannot know, because it is opaque text. This component's manifest
  describes, in Zaraz's own permissions UI, the one thing it does with that
  permission.
- The tool is named in the Tools list, with its own row in Zaraz's
  execution-time and error reporting, instead of being an anonymous entry inside
  Custom HTML's configuration.
- There is a single place to version it. Updating the tag (say, a new `data-*`
  attribute some future Pulse feature needs) means redeploying this Worker.
  With Custom HTML you would have to find and re-edit every site's pasted HTML
  block by hand.

None of this is a capability that Custom HTML lacks structurally. It is
discoverability, typing and auditability, and it adds no new power. If a site
owner is already comfortable pasting the tag into Custom HTML, this component
gives them tidiness but no new feature. It is still worth building because it
costs nothing to maintain (it has no backend, review queue or version matrix)
and it is the one way Pulse shows up by name in Zaraz's own Tools UI.

## Permissions

| Permission | Why |
|---|---|
| `execute_unsafe_scripts` | This permission is required for `client.execute()`, which adds the `<script>` element described above. It is the only permission requested. Pulse sets no cookies, so `access_client_kv` is not requested. The tracker makes its own requests once loaded, without going through Zaraz, so `client_network_requests` is not requested. There is no server-side forwarding, so `server_network_requests` and `manager.fetch` are not used. There is no proxy, route, served file or widget, so `provide_server_functionality` and `provide_widget` are not requested either. |

## What Pulse Analytics measures

Pulse Analytics measures pageviews, referrers, countries, devices, time on page and scroll depth, plus goals, funnels and campaigns.
It sets no cookies and never stores IP addresses.
Visitors whose browser sends Do Not Track or Global Privacy Control are not counted, so if you test in Brave or Firefox and see nothing, the tracker is behaving correctly.
Safari is the easiest browser to verify an install in.

## Testing: unit suite and a real WebCM install, both verified

```bash
npm install
npm run typecheck   # tsc --noEmit — clean
npm run test        # vitest run — 33 tests, all passing
npm run bundle      # esbuild → dist/index.js, ~1.7 KB minified, zero imports
```

In addition to the suite, this was verified by hand: importing the built
`dist/index.js` and calling its default export with a fake `Manager`/`Client`
produces the exact expected `client.execute()` call. This confirms the bundle is
real, working output. `tsc` and `vitest` only checked the source.

`scripts/verify.sh` has been run for real, in Docker, and is green (all 7
real-install cases pass, `--mutate` was confirmed to go red exactly where
intended, and a normal run was confirmed green again afterwards). Four first-run
harness defects were found and fixed along the way. None were defects in this
component's own code (`src/pulse.ts` and `src/index.ts` are unchanged from
before that run):

- `assert_case()` mounted its own fixture directory read-only, then tried to
  `npm install` into it. Every call failed silently, because the output was
  piped to `/dev/null`. The fix was to install once, up front, with a writable
  mount.
- The readiness wait after starting WebCM was 15s, while a cold
  `npx webcm@0.10.9` (no persistent cache) measured 7+ minutes. The fix was a
  persistent npm cache volume plus a generous, heartbeating wait.
- Checking HTTP connectivity showed that express was listening, but it said
  nothing about whether a pageview would be processed in time. This was isolated
  with a control (raw curl, no browser): WebCM's first real request to its track
  endpoint measured 6.78s and the second 0.15s. The fix was an explicit warm-up
  POST once per restart.
- The harness's `webcm.config.ts` used a path-based `DirectComponentConfig`.
  WebCM 0.10.9's own `ManagerGeneric.init()` hard-codes `settings = {}` for that
  branch. This was confirmed live, with a direct POST to `/webcm/track`:
  `data-domain`, `data-api` and `companion` were always absent, even with the
  corresponding settings correctly configured. This is a limitation of WebCM's
  local dev CLI. It does not apply to real Cloudflare Zaraz, whose
  component-loading implementation is separate. That implementation was not
  tested here and cannot be (no live Zaraz account; see "Open risks" below). The
  workaround was to switch the harness to a name-based `NamedComponentConfig`
  (mounted under `components/pulse/`, using the real `manifest.json`), which has
  no such bug.

The shipped bytes below were captured with a real headless browser against the
real `webcm@0.10.9` dev server:

```html
<!-- domain, api and companion all set -->
<script defer="" data-domain="example.com" data-api="https://proxy.example.com" src="https://js.ciphera.net/script.js"></script>
<script defer="" src="https://js.ciphera.net/script.interactions.js"></script>

<!-- domain empty (auto-detect) or invalid (dropped) — byte-identical either way -->
<script defer="" src="https://js.ciphera.net/script.js"></script>
```

The negative control (origin loaded directly, WebCM not in the path) and the
non-HTML case (`/data.json`) both carry zero `<script>` tags, confirmed by
`curl`. See `scripts/verify.sh`'s git history for the exact commits.

The tests prove the following, and one gap is left:

- `src/pulse.test.ts` proves the bootstrap-building logic: domain normalisation
  and validation, the companion/API behaviour, and exactly which DOM the
  generated JavaScript builds (executed against a real DOM via
  `new Function(js)()`, the same technique `pulse-astro` uses).
- `src/index.test.ts` proves the component's wiring against a fake
  `Manager`/`Client`: it registers one `pageview` listener, calls
  `client.execute()` with the right string, and touches nothing else.
- `scripts/verify.sh` proves what a real WebCM runtime does with this
  component: permission enforcement (`--mutate`), the full settings pipeline,
  and the DOM a real browser builds.
- A real Zaraz dashboard remains unverified. WebCM is the documented stand-in
  (see its own header comment), but Cloudflare's production component loader is
  separate, closed-source infrastructure. Nothing here tested it, and nothing
  here should be read as having done so (see `scripts/verify.sh`'s header
  comment and RELEASING.md).

## Open risks and unverified claims

None of this was driven against a real Cloudflare account or a real Zaraz
dashboard. That would need a Cloudflare account with Zaraz enabled on a zone,
which this work did not have. Everything above is built from the open
`managed-components` spec, Cloudflare's own public documentation, and three real
accepted components that were read (`demo`, `posthog-managed-component`,
`simpleanalytics/zaraz-integration`; see each section's citations). The
following items are unverified and should be checked against a live dashboard
before this is relied on:

- Whether `manifest.json`'s `fields` render as a typed settings form for a
  Custom Managed Component, or whether the dashboard is the free-text "Add
  Field" editor that PostHog's README describes. See "What the Zaraz dashboard
  actually renders" above. The component's own code is written to survive
  either outcome, but the install instructions in this README assume the
  latter.
- Whether `client.execute()`'s injected script interacts cleanly with a strict
  Content-Security-Policy. Cloudflare's own motivation docs
  (`getting-started/intro.md`) describe Managed Components generally as
  same-domain and more secure than a pasted tag, but nothing found describes the
  CSP mechanics of `client.execute()` specifically, and the dashboard's own
  permission-grant screen labels this permission `execute_unsafe_scripts`, a
  name that does not read like "CSP-exempt". Treat the Custom HTML comparison in
  "When this is worth it" as the baseline (same mechanism, same
  `execute_unsafe_scripts` permission). This component has not demonstrated a
  CSP advantage, so none is claimed.
- `webcm@0.10.9` was executed for real (`scripts/verify.sh`, see "Testing"
  above) and behaves as described, with one correction found along the way: its
  `DirectComponentConfig` (path-based) component shape silently discards
  `settings` (worked around in the harness; see "Testing").
  `npx managed-component-to-cloudflare-worker` remains unexecuted. The verify
  harness drives WebCM's own dev server directly (the same mechanism
  `managed-component-to-cloudflare-worker` wraps for local testing, per its own
  README), and it does not run the actual conversion to a deployable Cloudflare
  Worker. That step and a real Zaraz dashboard are still unverified (see
  "Testing" above and the next bullet).
- Whether a Cloudflare curated-catalogue submission is realistic at all. No
  documented public submission process was found (see LISTING.md).

## Licence

Copyright 2026 Ciphera BV. Licensed under the Apache License, Version 2.0. The
`LICENSE` file is the licence text verbatim, so the copyright line lives here.

Unlike the Drupal, Joomla and TYPO3 integrations, nothing about this platform
forces a different licence. Cloudflare's own curated components
(`google-analytics-4`, `mixpanel`, `demo`) and the community ones
(`posthog-managed-component`, `snowplow`) are all Apache-2.0, and no hosting
directory here imposes GPL the way drupal.org, the JED and TYPO3's TER do. This
package has zero runtime dependencies, and `npm run build` checks that it stays
that way by bundling and inspecting the result.

Cloudflare, Cloudflare Workers and Zaraz are trademarks of Cloudflare, Inc.
This is an independent component and is not affiliated with or endorsed by
Cloudflare. No Cloudflare mark is used in this repository's icon or listing
copy (see `LISTING.md`).
