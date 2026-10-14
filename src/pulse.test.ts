import { describe, it, expect } from "vitest"
import {
  SCRIPT_URL,
  COMPANION_URL,
  normalizeDomain,
  isValidDomain,
  isTruthy,
  resolveDomain,
  resolveApi,
  buildBootstrap,
} from "./pulse.js"

describe("normalizeDomain", () => {
  it("strips scheme, path, query, fragment, port and a trailing dot", () => {
    expect(normalizeDomain("https://Example.com/blog?x=1#y")).toBe("example.com")
    expect(normalizeDomain("  HTTP://example.com:8080/  ")).toBe("example.com")
    expect(normalizeDomain("example.com.")).toBe("example.com")
  })

  it("keeps www, because a Pulse site may be registered either way", () => {
    expect(normalizeDomain("https://www.example.com")).toBe("www.example.com")
  })

  it("agrees with pulse-astro's cuts on the cases that differ by order", () => {
    expect(normalizeDomain("a.com:8080/p?q#f")).toBe("a.com")
    expect(normalizeDomain("a.com/p:8080")).toBe("a.com")
  })
})

describe("isValidDomain", () => {
  it("accepts real hostnames", () => {
    for (const d of ["example.com", "www.example.com", "a.co", "sub.do-main.example.museum"]) {
      expect(isValidDomain(d), d).toBe(true)
    }
  })

  it("rejects anything that could break out of a JS string literal or isn't a hostname", () => {
    for (const d of [
      'a.com"',
      "a.com'",
      "a.com\\",
      "a.com\n",
      "a.com</script>",
      "a.com ",
      "a com.com",
      "localhost",
      "127.0.0.1",
      "",
      "-a.com",
      "a.com-",
    ]) {
      expect(isValidDomain(d), JSON.stringify(d)).toBe(false)
    }
  })
})

describe("isTruthy", () => {
  it("accepts a real boolean", () => {
    expect(isTruthy(true)).toBe(true)
    expect(isTruthy(false)).toBe(false)
  })

  it("accepts the strings a free-text Settings field can realistically hold", () => {
    for (const v of ["true", "TRUE", " true ", "1", "yes", "on"]) {
      expect(isTruthy(v), v).toBe(true)
    }
    for (const v of ["false", "0", "no", "off", "", "nope"]) {
      expect(isTruthy(v), v).toBe(false)
    }
  })

  it("never throws, and defaults anything else to off", () => {
    expect(isTruthy(undefined)).toBe(false)
    expect(isTruthy(null)).toBe(false)
    expect(isTruthy(0)).toBe(false)
    expect(isTruthy(1)).toBe(true)
    expect(isTruthy({})).toBe(false)
    expect(isTruthy([])).toBe(false)
  })
})

describe("resolveDomain", () => {
  it("reads a configured domain", () => {
    expect(resolveDomain({ domain: "Example.com" })).toBe("example.com")
  })

  it("returns null for an absent, empty or whitespace-only domain — auto-detect", () => {
    expect(resolveDomain({})).toBeNull()
    expect(resolveDomain({ domain: undefined })).toBeNull()
    expect(resolveDomain({ domain: null })).toBeNull()
    expect(resolveDomain({ domain: "" })).toBeNull()
    expect(resolveDomain({ domain: "   " })).toBeNull()
  })

  it("DROPS an invalid domain rather than throwing or injecting it", () => {
    // A Managed Component runs inside Zaraz's shared per-pageview execution;
    // an uncaught error here is a broken page for every tool on it, not a
    // failed build somebody is looking at. So this must never throw.
    expect(() => resolveDomain({ domain: 'a.com"+alert(1)+"' })).not.toThrow()
    expect(resolveDomain({ domain: 'a.com"+alert(1)+"' })).toBeNull()
    expect(resolveDomain({ domain: "not a domain" })).toBeNull()
  })

  it("coerces a non-string setting instead of crashing on it", () => {
    expect(resolveDomain({ domain: 123 as unknown as string })).toBeNull()
  })
})

describe("resolveApi", () => {
  it("trims whitespace and a trailing slash", () => {
    expect(resolveApi({ api: "  https://proxy.example.com/  " })).toBe("https://proxy.example.com")
  })

  it("returns null when unset or empty", () => {
    expect(resolveApi({})).toBeNull()
    expect(resolveApi({ api: "" })).toBeNull()
  })
})

describe("buildBootstrap", () => {
  it("never injects a domain that fails validation, even if one reaches it directly", () => {
    const js = buildBootstrap('a.com"+alert(1)+"')
    expect(js).not.toContain("alert(1)")
    expect(js).toContain("add(" + JSON.stringify(SCRIPT_URL) + ",null,null)")
  })

  it("emits only the core script by default", () => {
    const js = buildBootstrap("example.com")
    expect(js).toContain(SCRIPT_URL)
    expect(js).not.toContain(COMPANION_URL)
  })

  it("adds the companion as a SECOND request, never folded into the core", () => {
    const js = buildBootstrap("example.com", { companion: true })
    expect(js).toContain(SCRIPT_URL)
    expect(js).toContain(COMPANION_URL)
  })

  it("carries a custom API origin as a data-api argument to add()", () => {
    const js = buildBootstrap("example.com", { api: "https://proxy.example.com" })
    expect(js).toContain('"https://proxy.example.com"')
    expect(js).toContain("data-api")
  })
})

// The injected string IS the product on this platform — Zaraz never puts a
// literal <script> tag in the server-rendered HTML (see README), so the only
// artefact that can be wrong in a way reading the source wouldn't show is the
// DOM this string builds when a browser actually runs it.
describe("the bootstrap, executed", () => {
  function run(js: string): HTMLScriptElement[] {
    document.head.innerHTML = ""
    // eslint-disable-next-line no-new-func
    new Function(js)()
    return Array.from(document.head.querySelectorAll("script"))
  }

  it("appends one deferred, ordered script carrying data-domain", () => {
    const [s, ...rest] = run(buildBootstrap("example.com"))
    expect(rest).toHaveLength(0)
    expect(s!.src).toBe(SCRIPT_URL)
    expect(s!.getAttribute("data-domain")).toBe("example.com")
    expect(s!.hasAttribute("data-api")).toBe(false)
    expect(s!.async).toBe(false)
    expect(s!.defer).toBe(true)
  })

  it("carries data-api as a real attribute on the core script, matching TagBuilder.php", () => {
    const [s] = run(buildBootstrap("example.com", { api: "https://proxy.example.com" }))
    expect(s!.getAttribute("data-api")).toBe("https://proxy.example.com")
  })

  it("the companion carries no data-api of its own, same as data-domain", () => {
    const [, companion] = run(
      buildBootstrap("example.com", { companion: true, api: "https://proxy.example.com" })
    )
    expect(companion!.hasAttribute("data-api")).toBe(false)
  })

  it("omits data-domain entirely when auto-detecting — never an empty attribute", () => {
    const [s] = run(buildBootstrap(null))
    expect(s!.hasAttribute("data-domain")).toBe(false)
  })

  it("puts the core first and gives the companion no data-domain of its own", () => {
    const [core, companion] = run(buildBootstrap("example.com", { companion: true }))
    expect(core!.src).toBe(SCRIPT_URL)
    expect(companion!.src).toBe(COMPANION_URL)
    expect(companion!.hasAttribute("data-domain")).toBe(false)
  })

  it("an invalid domain is dropped, never injected, even executed end to end", () => {
    const [s] = run(buildBootstrap('bad" onload="x'))
    expect(s!.hasAttribute("data-domain")).toBe(false)
    expect(document.head.innerHTML).not.toContain("onload")
  })

  it("running the bootstrap twice in one document does not double-inject", () => {
    // Mutation-testable: delete the `ex[i].src===src` guard in pulse.ts and
    // this goes from 1 to 2.
    document.head.innerHTML = ""
    const js = buildBootstrap("example.com", { companion: true })
    // eslint-disable-next-line no-new-func
    new Function(js)()
    // eslint-disable-next-line no-new-func
    new Function(js)()
    const scripts = Array.from(document.head.querySelectorAll("script"))
    expect(scripts).toHaveLength(2) // core + companion, not 4
  })
})
