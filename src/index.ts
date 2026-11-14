import type { ComponentSettings, Manager, MCEvent } from "@managed-components/types"
import { buildBootstrap, resolveDomain, resolveApi, isTruthy, type PulseSettings } from "./pulse.js"

export type { PulseSettings, BootstrapOptions } from "./pulse.js"
export {
  SCRIPT_URL,
  normalizeDomain,
  isValidDomain,
  isTruthy,
  resolveDomain,
  resolveApi,
  buildBootstrap,
} from "./pulse.js"

/**
 * Pulse Analytics — privacy-first web analytics, as a Cloudflare Zaraz
 * Managed Component.
 *
 * Deliberately the smallest component this could be: one event listener, one
 * permission (`execute_unsafe_scripts`), no cookies, no server-side request of
 * our own, no `manager.fetch`. It puts Pulse's real tracker on the page —
 * `js.ciphera.net/script.js`, the exact file every other Pulse install loads
 * — rather than reimplementing any of its measurement logic inside Zaraz.
 * See README.md ("Why client-side injection instead of server-side forwarding")
 * for the reasoning and the trade-off this costs.
 *
 * Settings are resolved once, outside the event listener: they come from the
 * tool's configuration, not from any per-request state, so there is nothing
 * to recompute per pageview.
 */
export default async function (manager: Manager, settings: ComponentSettings) {
  const pulseSettings = settings as PulseSettings
  const domain = resolveDomain(pulseSettings)
  const api = resolveApi(pulseSettings)

  // The old `companion` value is accepted and ignored: a tool deployed before
  // 0.2.0 may still pass it. One line, once, at start-up.
  if (isTruthy(pulseSettings.companion)) {
    console.warn(
      "Pulse Analytics: the companion option has been ignored since 0.2.0: switch it in your site's settings in Pulse."
    )
  }

  manager.addEventListener("pageview", async (event: MCEvent) => {
    event.client.execute(buildBootstrap(domain, { api }))
  })
}
