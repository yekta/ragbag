// Neither entrypoint ships types: `geometry.js` is an untyped subpath of
// @napi-rs/canvas, and pdfjs' worker build has no declarations. pdf-globals.ts
// only hands both to globalThis, so opaque shapes are enough here.

declare module "@napi-rs/canvas/geometry.js" {
  export const DOMMatrix: unknown;
}

declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
