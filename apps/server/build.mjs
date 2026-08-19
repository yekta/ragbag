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
  // Left out of the bundle, and each for its own reason (see the Dockerfile,
  // which installs exactly these beside it):
  //
  //   sharp, @napi-rs/canvas  native: their entry points resolve a
  //     platform-specific .node binary, which esbuild has no loader for.
  //     @napi-rs/canvas used to reach the runtime only through pdfjs's dynamic
  //     require(), which esbuild never saw; rasterize-pdf.ts imports it
  //     directly now, so it has to be named.
  //   heic-decode  pulls in a 1.4 MB emscripten single-file build of libheif
  //     that expects to be loaded as its own module rather than inlined.
  //   ffmpeg-static  resolves the ffmpeg binary sitting next to its own
  //     index.js, so bundling it would point that path at dist/ instead.
  external: ["sharp", "@napi-rs/canvas", "heic-decode", "ffmpeg-static"],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
