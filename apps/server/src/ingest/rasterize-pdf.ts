import "./pdf-worker.js";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { toPlainBytes } from "./extract-pdf.js";

// One page per PDF, not twenty (plan §6.2).
//
// This exists ONLY for the thumbnail. OCR does not need it: a scanned PDF goes
// to the model as a file and the model renders the pages server-side. But
// nothing hands us back a page image for the grid, so page one is rendered
// locally.
//
// pdfjs is already in the tree; rendering rather than just reading text needs
// a canvas backend in Node, which is what @napi-rs/canvas is (already a
// dependency: pdfjs reaches for it at runtime to polyfill DOMMatrix/Path2D).
// sharp alone will not do this unless its libvips was built with poppler or
// pdfium, which is not something to rely on.

/** Long edge of the rendered page, before the thumbnail resize. */
const RENDER_MAX = 800;

/**
 * Render page one to PNG bytes. Returns null when the page cannot be drawn,
 * because a missing thumbnail is cosmetic: the caller falls back to a generic
 * tile with the filename and everything else about the PDF still works.
 */
export async function rasterizeFirstPage(bytes: Uint8Array): Promise<Uint8Array | null> {
  const task = getDocument({
    data: toPlainBytes(bytes),
    disableFontFace: true,
    useSystemFonts: true,
    verbosity: 0,
  });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(RENDER_MAX / Math.max(base.width, base.height), 2);
    const viewport = page.getViewport({ scale: Math.max(scale, 0.1) });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    // A PDF page is transparent where nothing is drawn, and a transparent
    // thumbnail over a dark theme is an unreadable black square.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    // pdfjs types its render parameters against the DOM lib, which a Node
    // build does not load, and @napi-rs/canvas is a stand-in for it rather
    // than an implementation of it. The shape is right; the nominal types are
    // what disagree, so the cast is on the whole object rather than naming
    // DOM types this project has no declarations for.
    await page.render({ canvas, canvasContext: context, viewport } as unknown as Parameters<
      typeof page.render
    >[0]).promise;
    page.cleanup();
    return canvas.encode("png");
  } catch {
    return null;
  } finally {
    await task.destroy();
  }
}
