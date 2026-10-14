// WebCM config for the verify harness. Deliberately reads settings from
// environment variables rather than being regenerated per case — WebCM
// re-reads this file only at process start, so scripts/verify.sh sets these
// and (re)starts the webcm container once per case instead of templating a
// new file each time.
//
// 🔴 Deliberately a NamedComponentConfig (`{name, settings, permissions}`,
// cloudflare/webcm's compConfig.ts), NOT the `path`-based DirectComponentConfig
// this started as. Proved with a control (raw curl POST to /webcm/track, no
// browser, first request 6.78s / second 0.15s — unrelated to this bug): WebCM
// 0.10.9's `ManagerGeneric.init()` hard-codes `settings = {}` for the `path`
// branch (src/manager.ts) — a DirectComponentConfig's own `settings` field is
// parsed, type-checked, and then silently thrown away before the component
// ever sees it. Confirmed live: `data-domain`/`data-api`/`companion` were
// always absent even with PULSE_DOMAIN etc. correctly set — not because this
// component mishandled them, but because they never arrived. The `name`
// branch (`fetchLocalComponent`) has no such bug and additionally validates
// our REAL manifest.json's `permissions` (the path branch used a trivial
// mock manifest with `permissions: {}`, so `hasRequiredPermissions` was
// never actually exercised before — see the `--mutate` note in verify.sh for
// what that changes for this harness). verify.sh mounts the built bundle at
// `components/pulse/index.js` and our manifest at `components/pulse/manifest.json`.
const settings = {
  domain: process.env.PULSE_DOMAIN ?? "",
  companion: process.env.PULSE_COMPANION ?? "false",
  api: process.env.PULSE_API ?? "",
}

// Overridable so --mutate can grant NO permissions and prove WebCM really
// enforces this — `Client.execute()` checks `checkPermissions` before acting
// (cloudflare/webcm's src/client.ts) and silently no-ops otherwise, which is
// the live, platform-level guarantee no unit test can observe (our fake
// Manager in src/index.test.ts is fully permissive). Comma-separated, empty
// string means no permissions granted at all.
const permissionsEnv = process.env.PULSE_PERMISSIONS ?? "execute_unsafe_scripts"
const permissions = permissionsEnv.split(",").map(p => p.trim()).filter(Boolean)

export default {
  components: [
    {
      name: "pulse",
      settings,
      permissions,
    },
  ],
  target: process.env.WEBCM_TARGET || "http://pulse-verify-zaraz-origin:8000",
  hostname: "0.0.0.0",
  trackPath: "/webcm/track",
  port: Number(process.env.WEBCM_PORT || 8787),
  // Not a real secret — a throwaway harness, never exposed outside the
  // verify-run's own Docker network.
  cookiesKey: "pulse-verify-zaraz-harness",
}
