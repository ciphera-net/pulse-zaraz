// Bundles the component to a single file, the shape
// `managed-component-to-cloudflare-worker` and Zaraz's "Custom Managed
// Component" loader both expect (one JS file, one default export). Config
// copied from managed-components/demo's esbuild.js — the catalogue's own
// reference component — not re-derived.
require('esbuild').buildSync({
  entryPoints: ['src/index.ts'],
  bundle: true,
  minify: true,
  platform: 'node',
  format: 'esm',
  target: ['esnext'],
  tsconfig: 'tsconfig.build.json',
  outfile: 'dist/index.js',
})
