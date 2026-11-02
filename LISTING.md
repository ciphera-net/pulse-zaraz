# Listing copy — Pulse Analytics for Zaraz

There are **two** places this copy is used, and they are smaller than every
other Pulse integration's listing:

1. The one-line entry in `managed-components/docs`'s community list
   (`src/pages/components.md` → <https://managedcomponents.dev/components>).
2. What a site owner sees inside their own Zaraz dashboard when they add this
   as a Custom Managed Component — the tool name and settings labels/
   descriptions, which come straight from `manifest.json`.

There is **no Cloudflare-reviewed listing form** to fill in — unlike the JED,
drupal.org or the TER, a Custom Managed Component is never submitted to
Cloudflare for review at all (see RELEASING.md). So most of the fields a
"LISTING.md" would normally carry (long description, tags/categories,
screenshots) do not have anywhere to go yet. This file is the copy for what
does exist today, plus what to prepare once/if a curated-catalogue submission
ever becomes possible.

## 1. `managed-components/docs` community list entry

The exact, minimal, accepted shape (from the merged PostHog PR,
`managed-components/docs#10`) is one list item:

```markdown
- [Pulse Analytics](https://github.com/ciphera-net/pulse-zaraz)
```

No description column exists in that list — every other entry is a bare
link. Do not add marketing copy there; it would be the only entry that does.

## 2. Zaraz dashboard copy (from `manifest.json`)

**Tool name:** `Pulse Analytics`

**Description** (manifest `description`, shown wherever Zaraz surfaces it):

> Privacy-first web analytics. No cookies, no IP addresses stored, and the script it
> adds to your pages is under 3 KB.

**Category:** `Analytics`

**Settings labels and descriptions:** see `manifest.json`'s `fields` array —
`domain`, `companion` ("Record clicks, copies and form submits"), `api`
("Custom API origin"). Keep these in step with README.md's Settings table;
they are the same three settings described twice, once for the dashboard and
once for the person reading the repo before they get there.

**Permission description:** one entry, `execute_unsafe_scripts` — see
`manifest.json` and README.md's Permissions section for the exact wording.
Do not add a permission "just in case"; the honest, minimal set is itself
part of what this component is worth over a free-text Custom HTML paste (see
README.md).

## Copy rules this listing follows (same as every other Pulse surface)

- Always "Pulse Analytics", never an abbreviation.
- "No cookies, no IP addresses stored" — never "GDPR compliant", "no tracking" or
  "no consent banner needed". Those are legal claims this repo does not make.
- "Under 3 KB" — never a specific different figure (e.g. "2.7 KB"). That is
  the one published size claim and it is shared across every Pulse surface;
  a different number here would be a second, disagreeing claim.
- Belgium / Switzerland facts only where stated in README.md ("built by
  Ciphera, a company in Belgium, and hosted in Switzerland").

## Icon

`assets/icon.svg` in this repo is a **placeholder** — a plain pulse-line
glyph drawn for this repository, not the real Pulse brand mark (which was not
available to build this integration). It carries no Cloudflare mark and
claims no affiliation. **Swap it for the real vector logo before this
component is ever loaded into a live Zaraz dashboard** — the file is small
enough that a stale placeholder icon would be the first thing a site owner
sees and the easiest thing to forget.

## Logo and trademark — no Cloudflare mark anywhere in this listing

Per the standing rule this estate has paid for across every other integration
researched in `Pulse/docs/plans/14-09-2026-integration-marketplaces-strategy.md`
§11a.1 — *"a platform logo goes on a Pulse card only when that platform's own
policy says so in words. Silence reads as no."* — **no search was done here
for a Cloudflare brand-usage policy**, so the default holds by the same
reasoning as every platform in that table: no Cloudflare logo, no Zaraz logo,
anywhere this component's own card or copy appears. "Pulse Analytics" is
named in text; Cloudflare and Zaraz are named in text, as trademarks of
Cloudflare, Inc. (see README.md's Licence section). If a submission to
Cloudflare's own curated catalogue is ever pursued, re-check Cloudflare's
actual brand guidelines before adding any mark — do not assume permission
either way without reading it in words, the same lesson every other platform
in that table paid for.

## If a curated-catalogue submission is ever pursued (not today)

Cloudflare's own ~29-repo catalogue has no documented public submission form
(checked: `developers.cloudflare.com/zaraz`, the `managed-components`
organisation's README and `docs` repo). The realistic path, if the owner ever
wants to pursue it, is contacting Cloudflare directly (the `demo` component's
`package.json` lists `managedcomponents@cloudflare.com` as the Managed
Components team's contact address) — not a PR this repo can open unilaterally.
Record that as an open item rather than a promise; do not reach out without
the owner's sign-off, the same bar as any other outward-facing submission in
that strategy doc.

## Screenshots

None are needed for either surface above — the `managed-components/docs` list
is a bare link, and a Custom Managed Component's dashboard entry is populated
from `manifest.json`, not from any uploaded image. If a curated-catalogue
submission is ever pursued, Cloudflare's actual requirements (if any) should
be read from their own submission process once it exists, not guessed here.
