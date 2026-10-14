// Runs inside the Playwright container, on the verify harness's Docker
// network. Loads ONE page with a real headless browser, waits for WebCM's
// automatic pageview round trip (its injected 'track' snippet calls
// `webcm.track('pageview')` the instant it runs — see cloudflare/webcm's
// src/browser/track.js — so no manual trigger is needed), then reads the
// resulting DOM. This is unavoidable for this platform: Zaraz/WebCM never put
// a literal <script> tag in the server-rendered HTML (see README.md, "What
// lands on the page") — the tag only exists in the DOM after a browser has
// actually run the injected JavaScript, so grep-the-response-body (the
// Drupal/Joomla/TYPO3 harnesses' technique) cannot see it at all here.
//
// One case per invocation, driven entirely by environment variables, so
// verify.sh's shell loop stays the single source of truth for what each case
// expects — the same shape as the Joomla harness's `check()` function.
//
// Env vars:
//   URL               page to load
//   LABEL             printed on pass/fail
//   EXPECT_SCRIPT     "1" | "0" — core script must (not) be present
//   EXPECT_DOMAIN     expected data-domain value, or "" for "attribute absent"
//   EXPECT_API        expected data-api value, or "" for "attribute absent"
//   EXPECT_COMPANION  "1" | "0" — companion script must (not) be present
//   WAIT_MS           how long to wait for the pageview round trip (default 2000)

import { chromium } from "playwright"

const SCRIPT_URL = "https://js.ciphera.net/script.js"
const COMPANION_URL = "https://js.ciphera.net/script.interactions.js"

const env = (name, fallback) => (process.env[name] === undefined ? fallback : process.env[name])
const url = env("URL")
const label = env("LABEL", url)
const expectScript = env("EXPECT_SCRIPT", "1") === "1"
const expectDomain = env("EXPECT_DOMAIN", "")
const expectApi = env("EXPECT_API", "")
const expectCompanion = env("EXPECT_COMPANION", "0") === "1"
const waitMs = Number(env("WAIT_MS", "2000"))

if (!url) {
  console.error("FAIL (no URL given)")
  process.exit(1)
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: "load" })
  // WebCM's injected runtime fires its pageview POST on load and evals the
  // response's `execute` array as soon as it returns — give it a moment
  // rather than racing it. (See the file header for why this cannot be
  // replaced with a response-body read.)
  await page.waitForTimeout(waitMs)

  const scripts = await page.evaluate(() =>
    Array.from(document.querySelectorAll("script")).map(s => ({
      src: s.src,
      domain: s.getAttribute("data-domain"),
      api: s.getAttribute("data-api"),
    }))
  )

  const core = scripts.find(s => s.src === SCRIPT_URL)
  const companion = scripts.find(s => s.src === COMPANION_URL)
  const failures = []

  if (expectScript && !core) failures.push(`expected ${SCRIPT_URL} present, it was not`)
  if (!expectScript && core) failures.push(`expected ${SCRIPT_URL} ABSENT, it was present`)

  if (core) {
    const gotDomain = core.domain ?? ""
    if (gotDomain !== expectDomain) {
      failures.push(`data-domain: expected ${JSON.stringify(expectDomain || "(absent)")}, got ${JSON.stringify(gotDomain || "(absent)")}`)
    }
    const gotApi = core.api ?? ""
    if (gotApi !== expectApi) {
      failures.push(`data-api: expected ${JSON.stringify(expectApi || "(absent)")}, got ${JSON.stringify(gotApi || "(absent)")}`)
    }
  }

  if (expectCompanion && !companion) failures.push(`expected companion script present, it was not`)
  if (!expectCompanion && companion) failures.push(`expected companion script ABSENT, it was present`)
  if (companion && (companion.domain || companion.api)) {
    failures.push(`companion must carry no data-domain/data-api of its own, got domain=${companion.domain} api=${companion.api}`)
  }

  if (failures.length === 0) {
    console.log(`PASS: ${label}`)
    process.exit(0)
  } else {
    console.log(`FAIL: ${label}`)
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
} finally {
  await browser.close()
}
