import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // buildBootstrap()'s output is executed against a real DOM in
    // pulse.test.ts — reading the generated string cannot prove the element
    // it builds, any more than it could for pulse-astro.
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
})
