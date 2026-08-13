import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

// Under Node, pdfjs runs its worker on the main thread and loads it with
// `import("./pdf.worker.mjs")` — a path relative to the running file. That is
// fine in dev, but the deployed server is a single esbuild bundle, so the
// import would miss and every PDF would fail. Registering the worker on this
// global is the hook pdfjs checks first, and importing it statically gets it
// bundled. Must be imported before pdfjs itself.

(globalThis as unknown as Record<string, unknown>).pdfjsWorker ??= pdfjsWorker;
