import "./pdf-worker.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Phase A for PDFs (plan §5.2), first half: the text layer via pdfjs-dist,
// which is local, free and costs no AI at all. That is the common case. A
// scanned document with no text layer falls through to the model, which
// renders the pages itself (extract-pdf-ocr.ts, build step 4); either way the
// output is the same `content_md` shape, so nothing downstream can tell which
// path produced it.

const MAX_PAGES = 200;
const MAX_CHARS = 300_000;

/** Below this much text a PDF is treated as having no usable text layer. */
export const TEXT_LAYER_MIN_CHARS = 40;

export type PdfExtraction = {
  /** `## Page N` markers preserved, per plan §5.3. */
  markdown: string;
  /** The raw text, for deciding whether the text layer is worth anything. */
  text: string;
  numPages: number;
  pagesRead: number;
};

/**
 * A plain Uint8Array pdfjs will accept.
 *
 * It rejects a Node Buffer outright ("Please provide binary data as
 * `Uint8Array`"), and `Buffer.slice()` returns another Buffer, so a defensive
 * copy is not by itself enough. The local-disk blob driver reads with
 * `readFile`, which is exactly where a Buffer comes from. It also takes
 * ownership of what it is given, so the copy has to happen either way.
 */
export function toPlainBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtraction> {
  const task = getDocument({
    data: toPlainBytes(bytes),
    disableFontFace: true,
    useSystemFonts: true,
    verbosity: 0,
  });
  const pdf = await task.promise;
  try {
    const pagesRead = Math.min(pdf.numPages, MAX_PAGES);
    const sections: string[] = [];
    const plain: string[] = [];
    let total = 0;
    for (let i = 1; i <= pagesRead && total < MAX_CHARS; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .trim();
      if (text) {
        sections.push(`## Page ${i}\n\n${text}`);
        plain.push(text);
        total += text.length;
      }
      page.cleanup();
    }
    return {
      markdown: sections.join("\n\n").slice(0, MAX_CHARS),
      text: plain.join("\n\n").slice(0, MAX_CHARS),
      numPages: pdf.numPages,
      pagesRead,
    };
  } finally {
    await task.destroy();
  }
}
