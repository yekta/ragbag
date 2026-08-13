import "./pdf-worker.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Stage 2 for PDFs (plan §7): the text layer via pdfjs-dist. Scanned PDFs
// without one fail with a retryable-by-hand error; page-image OCR is a later,
// explicitly-priced feature.

const MAX_PAGES = 100;
const MAX_CHARS = 300_000;

export type PdfExtraction = {
  text: string;
  numPages: number;
  pagesRead: number;
};

export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtraction> {
  const task = getDocument({
    // pdfjs requires a plain Uint8Array it can transfer/own; copy defensively.
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: true,
    verbosity: 0,
  });
  const pdf = await task.promise;
  try {
    const pagesRead = Math.min(pdf.numPages, MAX_PAGES);
    const pages: string[] = [];
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
        pages.push(text);
        total += text.length;
      }
      page.cleanup();
    }
    return {
      text: pages.join("\n\n").slice(0, MAX_CHARS),
      numPages: pdf.numPages,
      pagesRead,
    };
  } finally {
    await task.destroy();
  }
}
