import { DOMMatrix } from "@napi-rs/canvas/geometry.js";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

// pdfjs assumes a browser and, under Node, patches the two globals it needs out
// of the optional `@napi-rs/canvas` package via a runtime require(). The
// deployed server is a single esbuild bundle with no node_modules next to it,
// so that require() misses and pdfjs dies on a top-level `new DOMMatrix()`.
// Same story for the worker: pdfjs falls back to `import("./pdf.worker.mjs")`
// relative to the bundle, which does not exist either.
//
// So install both ourselves, statically, so esbuild bundles them:
//   - DOMMatrix is @napi-rs/canvas's vendored pure-JS geometry polyfill; the
//     33MB native binary stays a build-time-only artifact.
//   - Path2D is a stub. We only read the text layer, so nothing here ever
//     constructs one — throwing keeps a future renderer from failing silently.
//   - pdfjsWorker is the checked global pdfjs prefers over the dynamic import.
//
// Must be imported before pdfjs itself: ESM evaluates in import order, and
// pdfjs touches DOMMatrix while its own module body runs.

function UnsupportedPath2D(): never {
  throw new Error("Path2D is unavailable: the server reads PDF text, it does not render pages.");
}

const globals = globalThis as unknown as Record<string, unknown>;
globals.DOMMatrix ??= DOMMatrix;
globals.Path2D ??= UnsupportedPath2D;
globals.pdfjsWorker ??= pdfjsWorker;
