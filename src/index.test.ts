import { describe, it, expect, vi } from "vitest"
import type { Manager, MCEvent, Client } from "@managed-components/types"
import pulse, { SCRIPT_URL, COMPANION_URL } from "./index.js"

/**
 * This exercises the component's WIRING — that it registers exactly one
 * listener, on the right event, and calls the right Client method with the
 * right string — against a fake Manager/Client. It is the here-and-now
 * equivalent of the Drupal module's kernel test: pulse.test.ts proves what
 * the bootstrap string says, this proves the component hands that string to
 * the right place. Neither proves what a real Zaraz/WebCM runtime does with
 * it — that gap is exactly what scripts/verify.sh is for (see README).
 */
function fakeManager() {
  const listeners = new Map<string, Array<(event: MCEvent) => void | Promise<void>>>()
  const manager = {
    name: "fake",
    addEventListener: vi.fn((type: string, cb: (event: MCEvent) => void | Promise<void>) => {
      const arr = listeners.get(type) ?? []
      arr.push(cb)
      listeners.set(type, arr)
      return true
    }),
    createEventListener: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    route: vi.fn(),
    proxy: vi.fn(),
    serve: vi.fn(),
    useCache: vi.fn(),
    invalidateCache: vi.fn(),
    registerEmbed: vi.fn(),
    registerWidget: vi.fn(),
    fetch: vi.fn(),
  } as unknown as Manager
  return { manager, listeners }
}

function fakeClient(): Client {
  return {
    emitter: "test",
    userAgent: "vitest",
    language: "en",
    referer: "",
    ip: "203.0.113.1",
    url: new URL("https://example.com/"),
    fetch: vi.fn(),
    execute: vi.fn(),
    return: vi.fn(),
    set: vi.fn(),
    get: vi.fn(),
    attachEvent: vi.fn(),
    detachEvent: vi.fn(),
  } as unknown as Client
}

function fireEvent(
  listeners: Map<string, Array<(event: MCEvent) => void | Promise<void>>>,
  type: string,
  client: Client
) {
  const handlers = listeners.get(type) ?? []
  const event = { type, payload: {}, client } as unknown as MCEvent
  return Promise.all(handlers.map(h => h(event)))
}

describe("the component's wiring", () => {
  it("registers exactly one listener, on 'pageview'", async () => {
    const { manager, listeners } = fakeManager()
    await pulse(manager, { domain: "example.com" })
    expect(manager.addEventListener).toHaveBeenCalledTimes(1)
    expect(manager.addEventListener).toHaveBeenCalledWith("pageview", expect.any(Function))
    expect(listeners.has("pageview")).toBe(true)
  })

  it("on pageview, executes a bootstrap carrying the configured domain", async () => {
    const { manager, listeners } = fakeManager()
    await pulse(manager, { domain: "example.com" })
    const client = fakeClient()
    await fireEvent(listeners, "pageview", client)
    expect(client.execute).toHaveBeenCalledTimes(1)
    const js = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
    expect(js).toContain(SCRIPT_URL)
    expect(js).toContain('"example.com"')
    expect(js).not.toContain(COMPANION_URL)
  })

  it("auto-detect: an empty domain setting executes a bootstrap with no data-domain call", async () => {
    const { manager, listeners } = fakeManager()
    await pulse(manager, { domain: "" })
    const client = fakeClient()
    await fireEvent(listeners, "pageview", client)
    const js = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
    expect(js).toContain(`add(${JSON.stringify(SCRIPT_URL)},null,null)`)
  })

  it("an invalid domain setting never reaches the page — dropped, not thrown", async () => {
    const { manager, listeners } = fakeManager()
    await pulse(manager, { domain: "not a domain" })
    const client = fakeClient()
    await expect(fireEvent(listeners, "pageview", client)).resolves.not.toThrow()
    const js = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
    expect(js).toContain(`add(${JSON.stringify(SCRIPT_URL)},null,null)`)
  })

  it("companion as the literal string 'true' (a free-text Settings field) still turns it on", async () => {
    const { manager, listeners } = fakeManager()
    await pulse(manager, { domain: "example.com", companion: "true" })
    const client = fakeClient()
    await fireEvent(listeners, "pageview", client)
    const js = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
    expect(js).toContain(COMPANION_URL)
  })

  it("companion left unset stays off", async () => {
    const { manager, listeners } = fakeManager()
    await pulse(manager, { domain: "example.com" })
    const client = fakeClient()
    await fireEvent(listeners, "pageview", client)
    const js = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
    expect(js).not.toContain(COMPANION_URL)
  })

  it("a custom API origin reaches the bootstrap as a data-api argument", async () => {
    const { manager, listeners } = fakeManager()
    await pulse(manager, { domain: "example.com", api: "https://proxy.example.com/" })
    const client = fakeClient()
    await fireEvent(listeners, "pageview", client)
    const js = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
    expect(js).toContain('"https://proxy.example.com"')
    expect(js).toContain("data-api")
  })

  it("touches nothing but client.execute — no cookies, no client fetch, no server fetch", async () => {
    const { manager, listeners } = fakeManager()
    await pulse(manager, { domain: "example.com", companion: true })
    const client = fakeClient()
    await fireEvent(listeners, "pageview", client)
    expect(client.set).not.toHaveBeenCalled()
    expect(client.get).not.toHaveBeenCalled()
    expect(client.fetch).not.toHaveBeenCalled()
    expect(manager.fetch).not.toHaveBeenCalled()
    expect(manager.route).not.toHaveBeenCalled()
    expect(manager.proxy).not.toHaveBeenCalled()
    expect(manager.serve).not.toHaveBeenCalled()
  })
})
