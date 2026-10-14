#!/usr/bin/env bash
# Real-install harness for pulse-zaraz.
#
# There is no "install Zaraz locally" — Zaraz is Cloudflare's own edge
# product, not self-hostable. The documented, maintained substitute is WebCM
# (webcm.dev / cloudflare/webcm), the open-source reference Component
# Manager that implements the same Managed Components API Zaraz does — the
# Managed Components docs point here explicitly for testing
# (managedcomponents.dev/getting-started/components-manager). This script
# stands WebCM up in Docker, proxies a trivial fixture site through it, loads
# THIS component for real, and drives a real headless browser against the
# result.
#
# WHY A BROWSER, AND NOT A RESPONSE-BODY GREP (the Drupal/Joomla/TYPO3
# technique): a Managed Component's tag never appears in server-rendered
# HTML. WebCM/Zaraz inject their own loader into <head>, and that loader
# makes a round trip ANNOUNCING a pageview before the server replies with the
# JavaScript this component queued up via `client.execute()` — so the tag
# only exists in the DOM after a real browser has run that reply. See
# README.md, "What lands on the page", and cloudflare/webcm's
# src/browser/track.js / src/server.ts for the mechanism this harness relies
# on.
#
# Usage:
#   scripts/verify.sh              # build, run every case, report pass/fail
#   scripts/verify.sh --mutate     # also prove a WebCM-enforced guarantee can fail
#
# Needs Docker. Run for real: all 7 cases pass, --mutate goes red exactly
# where intended and a plain run is green again straight after (see
# RELEASING.md and README.md's "Testing" section for the full result and
# the four first-run harness defects that run found and fixed).
#
# All Docker resources are named pulse-verify-zaraz-*, and teardown removes
# ONLY those, by name — never `docker system prune` or similar. Safe to
# re-run: a previous interrupted run's resources are cleaned up first, by the
# same names.

set -uo pipefail

PREFIX="pulse-verify-zaraz"
NETWORK="${PREFIX}-net"
ORIGIN="${PREFIX}-origin"
WEBCM="${PREFIX}-webcm"
BUILD="${PREFIX}-build"
FIXTURE_BUILD="${PREFIX}-fixture-build"
# Persists WebCM's `npx` resolve-and-extract across every run_webcm restart in
# this run (npx's own content-addressed cache lives under here, keyed by
# package spec) — see run_webcm's comment for why this is load-bearing, not
# an optimisation.
NPM_CACHE="${PREFIX}-npm-cache"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$ROOT/scripts/fixture"

# Pinned together on purpose:
#   - WEBCM_IMAGE matches cloudflare/webcm's .nvmrc (v18.0.0) — WebCM is
#     reported not to run on newer Node (posthog-managed-component's README).
#   - WEBCM_VERSION is the published `webcm` npm version this was written
#     and reasoned against.
#   - PLAYWRIGHT_IMAGE's tag must match scripts/fixture/package.json's
#     `playwright` version exactly, or `npm install` there pulls a
#     `playwright` build that does not match the image's preinstalled
#     browsers, and the assert step either fails to launch or silently
#     downloads browsers over the network.
WEBCM_IMAGE="node:18-bookworm"
WEBCM_VERSION="0.10.9"
PLAYWRIGHT_IMAGE="mcr.microsoft.com/playwright:v1.49.1-jammy"
CURL_IMAGE="curlimages/curl:8.10.1"

MUTATE=0
[ "${1:-}" = "--mutate" ] && MUTATE=1

command -v docker >/dev/null 2>&1 || { echo "REFUSING: docker is not on PATH"; exit 1; }

FAILURES=0

cleanup_named_resources() {
  docker rm -f "$ORIGIN" "$WEBCM" "$BUILD" "$FIXTURE_BUILD" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  docker volume rm "$NPM_CACHE" >/dev/null 2>&1 || true
}
trap cleanup_named_resources EXIT

# A previous interrupted run may have left these; same names only, never a
# prune, and never anything not matching this prefix.
cleanup_named_resources

echo "==> network"
docker network create "$NETWORK" >/dev/null
docker volume create "$NPM_CACHE" >/dev/null

echo "==> origin fixture (the site WebCM/Zaraz proxies)"
docker run -d --name "$ORIGIN" --network "$NETWORK" \
  -v "$FIXTURE/site":/site:ro -v "$FIXTURE/serve.py":/serve.py:ro \
  python:3.12-slim python3 /serve.py >/dev/null
for _ in $(seq 1 20); do
  docker run --rm --network "$NETWORK" "$CURL_IMAGE" \
    -sf -o /dev/null "http://$ORIGIN:8000/" && break
  sleep 0.5
done

build_component() {
  # $1 source root to build from, $2 container name
  echo "==> building the component from $1"
  docker run --rm --name "$2" -v "$1":/work -w /work node:20-bookworm \
    sh -c "npm ci --no-audit --no-fund >/dev/null && npm run build" \
    || { echo "REFUSING: build failed for $1"; exit 1; }
  [ -f "$1/dist/index.js" ] || { echo "REFUSING: dist/index.js was not produced ($1)"; exit 1; }
}

build_component "$ROOT" "$BUILD"

# One-time install of scripts/fixture's own npm dependency (just
# `playwright`, matched to PLAYWRIGHT_IMAGE — see the pin comment above).
# assert_case() used to run `npm install` itself, per invocation, INTO A
# READ-ONLY BIND MOUNT of this same directory (`-v "$FIXTURE":/fixture:ro`)
# — every single call failed with `ENOENT: mkdir '/fixture/node_modules'`,
# and because that step's output was piped to `/dev/null` before the `&&`,
# the failure was completely silent: no case ever actually ran `assert.mjs`,
# and nothing printed said so. Found with a control: the same `npm install`
# against the identical image succeeds instantly once the mount is writable
# (confirmed with `docker run ... -v "$FIXTURE":/fixture:rw ...`). Installing
# once, here, with a writable mount, and having assert_case() mount the
# result read-only and skip `npm install` entirely, fixes the bug AND saves
# the ~2 minutes/case this was silently spending on a doomed install.
echo "==> fixture deps (the Playwright npm package — browsers are already baked into the image)"
docker run --rm --name "$FIXTURE_BUILD" -v "$FIXTURE":/fixture -w /fixture "$PLAYWRIGHT_IMAGE" \
  npm install --no-audit --no-fund \
  || { echo "REFUSING: fixture npm install failed"; exit 1; }
[ -d "$FIXTURE/node_modules/playwright" ] || { echo "REFUSING: fixture node_modules/playwright was not produced"; exit 1; }

# True if $WEBCM has exited (crashed, or exited 0) rather than still starting
# — lets both wait loops below fail FAST on a dead container instead of
# spinning out their whole budget. Real for `--mutate` with NO permissions
# granted: WebCM's `hasRequiredPermissions()` (src/manager.ts) reads our
# REAL manifest.json (see webcm.config.ts's header comment on why this is
# now the name-based NamedComponentConfig, not the path-based one) and calls
# `process.exit(1)` synchronously, inside `manager.init()`, BEFORE
# `app.listen()` ever runs — so express never starts and plain HTTP
# connectivity never arrives. Without this check, that correct, intentional
# failure would silently burn the full 600s budget below every `--mutate` run.
webcm_exited() {
  local status
  status="$(docker inspect -f '{{.State.Status}}' "$WEBCM" 2>/dev/null)" || return 0
  [ "$status" = "running" ] && return 1
  return 0
}

run_webcm() {
  # $1 dist-dir source, $2 domain, $3 companion, $4 api, $5 permissions (csv, may be empty)
  docker rm -f "$WEBCM" >/dev/null 2>&1 || true
  # NamedComponentConfig (see webcm.config.ts): mounted under webcm's default
  # `./components/<name>/` lookup, as a bare `index.js` (no package.json —
  # fetchLocalComponent falls back to index.{mjs,js,mts,ts} directly) plus
  # our REAL manifest.json, so permission *requirements* are validated
  # against the actual shipped manifest, not a trivial mock.
  docker run -d --name "$WEBCM" --network "$NETWORK" \
    -v "$1/dist/index.js":/app/components/pulse/index.js:ro \
    -v "$ROOT/manifest.json":/app/components/pulse/manifest.json:ro \
    -v "$FIXTURE/webcm.config.ts":/app/webcm.config.ts:ro \
    -v "$NPM_CACHE:/root/.npm" \
    -w /app \
    -e PULSE_DOMAIN="$2" -e PULSE_COMPANION="$3" -e PULSE_API="$4" \
    -e PULSE_PERMISSIONS="$5" \
    -e WEBCM_TARGET="http://$ORIGIN:8000" -e WEBCM_PORT=8787 \
    "$WEBCM_IMAGE" npx --yes "webcm@$WEBCM_VERSION" -c webcm.config.ts >/dev/null
  # `npx --yes webcm@$WEBCM_VERSION` resolves and extracts the full
  # dependency tree (ts-node, typescript, express, jsdom, ~200 packages)
  # fresh, every time, into `/root/.npm/_npx/<hash>` — npx's own
  # content-addressed cache, keyed by package spec. Mounting that path as a
  # persistent volume (above) means only the FIRST call in a run pays for
  # the network resolve + extract; every later run_webcm (a fresh container,
  # same image, same spec) finds its `_npx/<hash>` already populated and
  # starts in seconds. Measured cold, uncached, on this harness's first
  # real run: still building node_modules 7+ minutes in, no crash, just
  # slow — so the wait budget below is sized for a COLD run; a cached one
  # is far faster. A heartbeat prints every ~20s so a long cold start does
  # not read as a hang.
  local elapsed=0
  while [ "$elapsed" -lt 600 ]; do
    docker run --rm --network "$NETWORK" "$CURL_IMAGE" \
      -sf -o /dev/null "http://$WEBCM:8787/" && break
    if webcm_exited; then
      echo "    REFUSING: webcm's container exited while starting (after ${elapsed}s) — see docker logs $WEBCM"
      return 1
    fi
    sleep 2
    elapsed=$((elapsed+2))
    if [ $((elapsed % 20)) -eq 0 ]; then
      echo "    ...still waiting for webcm (${elapsed}s)"
    fi
  done
  if [ "$elapsed" -ge 600 ]; then
    echo "    REFUSING: webcm did not come up within ${elapsed}s"
    return 1
  fi

  # 🔴 HTTP connectivity (the loop above) proves express is listening, NOT
  # that a pageview will actually be processed in time. Isolated with a
  # control (raw curl, no browser): WebCM's FIRST real POST to its track
  # endpoint on a freshly-started process measured 6.78s; the SECOND,
  # 0.15s — a ~45x one-time cost, reproduced on demand, that has nothing to
  # do with this component (no server-side error is ever logged either
  # time). Left unabsorbed here, assert_case()'s very first call after
  # every webcm restart raced this warm-up and intermittently found no
  # script tag — not because the component failed, but because the
  # browser's own real pageview WAS the slow "first" request. Firing one
  # harmless dummy POST here, synchronously, pays that cost once per
  # restart instead of once per case, and keeps assert.mjs's own WAIT_MS
  # meaningful (it now only ever races an already-warm server).
  elapsed=0
  while [ "$elapsed" -lt 60 ]; do
    docker run --rm --network "$NETWORK" "$CURL_IMAGE" \
      -sf -o /dev/null -X POST "http://$WEBCM:8787/webcm/track" \
      -H 'Content-Type: application/json' \
      -d '{"location":"http://warmup.invalid/","title":"","pageVars":{"__client":{}},"timestamp":0,"offset":0,"referer":"","eventType":"pageview"}' \
      && return 0
    if webcm_exited; then
      echo "    REFUSING: webcm's container exited during warm-up (after ${elapsed}s) — see docker logs $WEBCM"
      return 1
    fi
    sleep 1
    elapsed=$((elapsed+1))
  done
  echo "    REFUSING: webcm's track endpoint never warmed up within ${elapsed}s"
  return 1
}

assert_case() {
  # $1 label, $2 url, $3 expect_script(1/0), $4 expect_domain, $5 expect_api, $6 expect_companion(1/0)
  # Deps are installed once, above, into $FIXTURE/node_modules — mounted
  # read-only here on purpose (nothing in this container should write to
  # the fixture). Do NOT reintroduce a per-call `npm install`: see the
  # comment on the install step above for why that silently never worked.
  docker run --rm --network "$NETWORK" \
    -v "$FIXTURE":/fixture:ro -w /fixture \
    -e URL="$2" -e LABEL="$1" -e EXPECT_SCRIPT="$3" -e EXPECT_DOMAIN="$4" \
    -e EXPECT_API="$5" -e EXPECT_COMPANION="$6" \
    "$PLAYWRIGHT_IMAGE" \
    node assert.mjs
}

echo
echo "==> real-install cases"

run_webcm "$ROOT" "example.com" "false" "" "execute_unsafe_scripts" || FAILURES=$((FAILURES+1))
assert_case "domain only" "http://$WEBCM:8787/" 1 "example.com" "" 0 \
  && echo "  ok" || FAILURES=$((FAILURES+1))

run_webcm "$ROOT" "chosen.dev" "true" "https://proxy.example.com" "execute_unsafe_scripts" || FAILURES=$((FAILURES+1))
assert_case "domain + api + companion, companion carries neither of its own" "http://$WEBCM:8787/" 1 "chosen.dev" "https://proxy.example.com" 1 \
  && echo "  ok" || FAILURES=$((FAILURES+1))

run_webcm "$ROOT" "" "false" "" "execute_unsafe_scripts" || FAILURES=$((FAILURES+1))
assert_case "empty domain means auto-detect, not a broken attribute" "http://$WEBCM:8787/" 1 "" "" 0 \
  && echo "  ok" || FAILURES=$((FAILURES+1))

# 🔴 This is the case that would have caught an injected-domain defect the
# way the Joomla ?version= case caught a real one: an invalid domain must be
# DROPPED, never put in the DOM.
run_webcm "$ROOT" 'bad" onload="x' "false" "" "execute_unsafe_scripts" || FAILURES=$((FAILURES+1))
assert_case "an invalid domain is dropped, never injected" "http://$WEBCM:8787/" 1 "" "" 0 \
  && echo "  ok" || FAILURES=$((FAILURES+1))

echo
echo "==> negative control (no component in the path at all)"
assert_case "the origin with no component in front of it carries no tag" "http://$ORIGIN:8000/" 0 "" "" 0 \
  && echo "  ok" || FAILURES=$((FAILURES+1))

echo
echo "==> non-HTML response (WebCM/Zaraz only ever rewrite text/html — src/server.ts)"
run_webcm "$ROOT" "example.com" "false" "" "execute_unsafe_scripts" || FAILURES=$((FAILURES+1))
assert_case "a JSON response gets no component runtime and no tag" "http://$WEBCM:8787/data.json" 0 "" "" 0 \
  && echo "  ok" || FAILURES=$((FAILURES+1))

if [ "$MUTATE" = "1" ]; then
  echo
  echo "==> --mutate: granting NO permissions and proving the 'domain only' case goes red"
  # Deliberately not a source-code mutation: src/pulse.ts's domain validation
  # is already mutation-tested at the unit level (src/pulse.test.ts — see the
  # repo's development notes). The thing ONLY a real run can prove is that
  # WebCM/Zaraz actually enforce the declared permission: `Client.execute()`
  # checks `checkPermissions()` before acting and silently no-ops otherwise
  # (cloudflare/webcm's src/client.ts) — our fake Manager in
  # src/index.test.ts is fully permissive and cannot see this at all.
  run_webcm "$ROOT" "example.com" "false" "" "" || true  # "" = no permissions granted
  if assert_case "[MUTATED: no permissions granted] domain only" "http://$WEBCM:8787/" 1 "example.com" "" 0; then
    echo "  MUTATION DID NOT BREAK THE ASSERTION — WebCM's permission enforcement,"
    echo "  or this harness's wiring of it, is not doing what it should. Treat this"
    echo "  as a harness failure, not a pass."
    FAILURES=$((FAILURES+1))
  else
    echo "  ok — the assertion correctly went red once execute_unsafe_scripts was withheld"
  fi
fi

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "pulse-zaraz verify: ALL CHECKS PASSED"
else
  echo "pulse-zaraz verify: $FAILURES FAILURE(S)"
fi
exit "$FAILURES"
