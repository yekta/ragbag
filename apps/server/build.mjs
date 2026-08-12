import { build } from "esbuild";

// Bundle the server (workspace packages included) into a single ESM file so
// the runtime image needs no node_modules. The createRequire banner keeps any
// stray require() calls from bundled CJS deps working under ESM.
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/index.js",
  sourcemap: true,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
