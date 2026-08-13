// pdfjs ships no declarations for its worker build. pdf-worker.ts only hands
// the module to globalThis, so an opaque shape is enough.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
