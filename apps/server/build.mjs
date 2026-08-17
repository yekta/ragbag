import { build } from "esbuild";

// Bundle the server (workspace packages included) into a single ESM file so
// the runtime image needs almost no node_modules. The createRequire banner
// keeps any stray require() calls from bundled CJS deps working under ESM.
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/index.js",
  sourcemap: true,
  // Native modules cannot be bundled: their entry points resolve a
  // platform-specific .node binary, which esbuild has no loader for. Both of
  // these travel beside the bundle instead (see the Dockerfile).
  //
  // @napi-rs/canvas used to reach the runtime through pdfjs's own dynamic
  // require(), which esbuild never saw. rasterize-pdf.ts imports it directly
  // now (to render a PDF's first page for its thumbnail), so it has to be
  // named here too.
  external: ["sharp", "@napi-rs/canvas"],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
