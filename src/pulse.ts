// Pure logic for the Pulse Zaraz Managed Component: what to inject, and with
// which domain. No `@managed-components/types` value import here (only the
// `ComponentSettings` TYPE is used in index.ts), so all of it is unit-tested
// with no Manager, no Client, no Zaraz and no WebCM.
//
// The URLs and the domain grammar are copied from `pulse-astro`'s
// `src/pulse.ts`, not re-derived. Two Pulse install surfaces disagreeing about
// what the tag looks like is a drift bug waiting to happen.

export const SCRIPT_URL = "https://js.ciphera.net/script.js"
export const COMPANION_URL = "https://js.ciphera.net/script.interactions.js"

/** A registrable hostname: labels of letters, digits and hyphens, at least one
 *  dot, a letter-only TLD. Deliberately strict — the value is interpolated
 *  into injected JavaScript (via `JSON.stringify`, which already escapes a
 *  quote or backslash; this is the second guard, not the only one) and this
 *  shape cannot carry a quote, a backslash or a line terminator regardless. */
const DOMAIN_RE =
  /^(?=.{1,253}$)(?!-)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/

/** Lower-case, drop a scheme, path, query, fragment, port and a trailing dot.
 *  Keeps `www.` — the Pulse site may be registered either way and the site
 *  owner can edit it. Identical to `pulse-astro`'s cuts. */
export function normalizeDomain(input: string): string {
  let s = input.trim().toLowerCase()
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
  s = s.replace(/[/?#].*$/, "")
  s = s.replace(/:.*$/, "")
  s = s.replace(/\.$/, "")
  return s
}

export function isValidDomain(domain: string): boolean {
  return DOMAIN_RE.test(domain)
}

/** The settings shape Zaraz hands back as `ComponentSettings`. A Custom
 *  Managed Component's own "Settings" screen is a free-text key/value editor
 *  (see README, "What the Zaraz dashboard renders"), not a typed
 *  form built from this manifest, so `companion` can arrive as a real boolean
 *  OR as whatever string the site owner typed into a text field. */
export interface PulseSettings {
  domain?: unknown
  companion?: unknown
  api?: unknown
}

/** Coerce a free-text-or-boolean setting to a boolean without ever throwing.
 *  `true`/`"true"`/`"1"`/`"yes"`/`"on"` (case/whitespace-insensitive) are on;
 *  everything else, including `undefined`, is off. */
export function isTruthy(value: unknown): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") {
    return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase())
  }
  return false
}

/** Resolve the configured domain, or `null` to let the tracker auto-detect
 *  the browser's own hostname. NEVER throws: unlike `pulse-astro`'s
 *  `resolveDomain`, which fails a build the person is looking at, this runs
 *  inside Zaraz's shared per-pageview execution — an uncaught error here is a
 *  broken page, not a failed build. So a domain that cannot be a hostname is
 *  dropped, exactly like the Drupal, Joomla and TYPO3 integrations: a working
 *  install one attribute short, never a broken one. */
export function resolveDomain(settings: PulseSettings): string | null {
  if (settings.domain === undefined || settings.domain === null) return null
  const trimmed = String(settings.domain).trim()
  if (trimmed === "") return null
  const normalized = normalizeDomain(trimmed)
  return isValidDomain(normalized) ? normalized : null
}

/** Resolve a bare custom API origin, or `null` for the default. A trailing
 *  slash is trimmed — the tracker appends its own path. */
export function resolveApi(settings: PulseSettings): string | null {
  if (settings.api === undefined || settings.api === null) return null
  const trimmed = String(settings.api).trim().replace(/\/+$/, "")
  return trimmed === "" ? null : trimmed
}

export interface BootstrapOptions {
  companion?: boolean
  api?: string | null
}

/** Builds the JavaScript that Zaraz's client runtime evaluates in the browser
 *  via `client.execute()`. `client.execute` takes a JS source string, the
 *  same constraint as Astro's `injectScript` — no parameter for `src`,
 *  `defer` or `data-*` — so the literal
 *  `<script defer data-domain="…" src="…">` tag is not expressible and the
 *  element has to be built in the DOM instead. See README for why this is the
 *  right trade-off for Pulse specifically.
 *
 *  `api` ships as a `data-api` ATTRIBUTE on the core script element, matching
 *  `TagBuilder.php` (Drupal) and the Joomla/TYPO3 integrations — not as
 *  `window.pulseConfig`, which is how `pulse-astro`'s bootstrap does it.
 *  That is a deliberate departure from the component this one otherwise
 *  mirrors most closely: three of our four other platform integrations treat
 *  `data-api` as a literal attribute on the tag, and this component already
 *  builds the element with `setAttribute` for `data-domain`, so adding a
 *  second attribute the same way is both simpler than a separate global and
 *  agrees with the majority, which is the whole point of copying rather than
 *  re-deriving — see the file header.
 *
 *  Three details are load-bearing, copied from `pulse-astro`'s
 *  `buildBootstrap`:
 *  - `async = false` keeps the two scripts (core + companion) in insertion
 *    order, belt and braces rather than a correctness requirement.
 *  - `data-domain` and `data-api` are set BEFORE the element is appended, so
 *    they are already on the element when the tracker reads
 *    `document.currentScript` during its own execution. A classic script
 *    inserted this way still sets `currentScript`; a module script would not.
 *  - `add()` is a no-op if a script with the same `src` already exists on the
 *    page — the same double-injection guard Simple Analytics' own Zaraz
 *    component uses, so re-running this bootstrap in one document is safe.
 */
export function buildBootstrap(domain: string | null, options: BootstrapOptions = {}): string {
  // Defensive only: resolveDomain() already guarantees this for the real
  // entry point, but buildBootstrap is exercised directly in tests and must
  // never inject a domain that failed validation some other way.
  const safeDomain = domain !== null && isValidDomain(domain) ? domain : null
  const api = options.api ?? null

  const lines: string[] = ["(function(){", 'var d=document,h=d.head||d.documentElement;if(!h)return;']

  // Guard against double injection, the same shape Simple Analytics' own
  // Zaraz component uses (`document.getElementById("sa-script")` before it
  // appends). Pulse's tracker handles its own SPA navigation once loaded, so
  // this component only ever calls `add` from the single `pageview` handler
  // — but a defensive check here is cheap, and it is exactly what would save
  // this component if Zaraz ever re-fired `pageview` for one document, or a
  // future change added a second call site.
  lines.push("function add(src,domain,api){")
  lines.push("var ex=d.getElementsByTagName(\"script\");")
  lines.push("for(var i=0;i<ex.length;i++){if(ex[i].src===src)return;}")
  lines.push('var s=d.createElement("script");s.async=false;s.defer=true;')
  lines.push('if(domain)s.setAttribute("data-domain",domain);')
  lines.push('if(api)s.setAttribute("data-api",api);')
  lines.push("s.src=src;h.appendChild(s);}")

  lines.push(
    `add(${JSON.stringify(SCRIPT_URL)},${safeDomain === null ? "null" : JSON.stringify(safeDomain)},${
      api === null ? "null" : JSON.stringify(api)
    });`
  )
  if (options.companion) lines.push(`add(${JSON.stringify(COMPANION_URL)},null,null);`)

  lines.push("})();")
  return lines.join("")
}
