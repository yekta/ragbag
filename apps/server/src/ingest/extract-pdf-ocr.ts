import { toFile } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { env } from "../env.js";
import { openai } from "./openai.js";
import { recordUsage, tokenUsage } from "./usage.js";

// Phase A for PDFs (plan §5.2), second half: the scanned ones.
//
// v1 read only the text layer and hard-failed a scanned PDF with "OCR for
// scanned PDFs isn't supported yet". v2 supports it, and WITHOUT rasterizing
// pages ourselves: the Responses API accepts a PDF directly and renders its
// pages server-side. `input_file` takes `file_data` (base64), `file_id` or
// `file_url`, plus a `detail` level whose own doc comment states that `auto`
// "uses high-quality rendering, which may increase input token usage".
//
// The output format is identical to the text-layer path's, so nothing
// downstream needs to know which one produced it. The format is the interface.
//
// Bounds, because the cost driver is PAGES RENDERED, not API calls: a single
// request containing a 200-page scan is expensive no matter that it is one
// call (plan §14.2).
//
//   - detail defaults to `low` (AI_PDF_DETAIL). The real lever.
//   - the page count is checked before anything is sent (AI_PDF_MAX_PAGES),
//     and a document past the cap is reported, never silently truncated.
//   - past a size threshold the bytes go through the Files API and the
//     request carries a `file_id`, which also lets a re-ingest reuse the
//     upload instead of paying to send it again.
//
// Service-side limits on pages and request size are OpenAI's and change; these
// are our own bounds, deliberately below whatever theirs happen to be.

/**
 * Above this, `file_data` stops being reasonable in a request body and the
 * bytes go through the Files API instead.
 */
const FILE_API_THRESHOLD_BYTES = 8 * 1024 * 1024;

const PdfTranscription = z.object({
  /** A short human title for the card, e.g. "Invoice: Acme, March". */
  title: z.string(),
  /** 1-3 plain sentences. */
  summary: z.string(),
  /** The document transcribed, with a `## Page N` heading before each page. */
  content_md: z.string(),
});

export type TPdfOcrResult = z.infer<typeof PdfTranscription> & {
  /** True when the page cap bit and only the leading pages were considered. */
  truncated: boolean;
};

/** What the model is asked for; the page markers are the downstream contract. */
const PROMPT =
  "This PDF was sent to a personal archive and has no usable text layer. " +
  "Transcribe it for search: put the text of each page into content_md under a " +
  "`## Page N` heading, in order, preserving headings and tables as markdown. " +
  "Transcribe verbatim; never summarise inside content_md and never invent text " +
  "that is not legible. Also give a short title (max 8 words) and a 1-3 sentence " +
  "summary of the whole document.";

export class PdfTooLongError extends Error {}

/**
 * Hand a scanned PDF to the model. Throws PdfTooLongError past the page cap,
 * which the caller turns into a note on the row rather than a failure: the
 * text layer (however thin) and the file itself survive either way.
 */
export async function transcribePdf(input: {
  bytes: Uint8Array;
  filename: string;
  numPages: number;
  userId: string;
  messageId: string;
  attachmentId: string;
}): Promise<TPdfOcrResult | null> {
  if (!openai) return null;
  if (input.numPages > env.AI_PDF_MAX_PAGES) {
    throw new PdfTooLongError(
      `this PDF is ${input.numPages} pages and has no text layer; the scanned-document ` +
        `limit is ${env.AI_PDF_MAX_PAGES} pages (AI_PDF_MAX_PAGES). Nothing was read from it.`,
    );
  }

  const file: { file_data?: string; file_id?: string } =
    input.bytes.byteLength > FILE_API_THRESHOLD_BYTES
      ? {
          file_id: (
            await openai.files.create({
              file: await toFile(Buffer.from(input.bytes), input.filename, {
                type: "application/pdf",
              }),
              purpose: "user_data",
            })
          ).id,
        }
      : {
          file_data: `data:application/pdf;base64,${Buffer.from(input.bytes).toString("base64")}`,
        };

  const res = await openai.responses.parse({
    model: env.AI_ENRICH_MODEL,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: PROMPT },
          {
            type: "input_file",
            filename: input.filename,
            detail: env.AI_PDF_DETAIL,
            ...file,
          },
        ],
      },
    ],
    text: { format: zodTextFormat(PdfTranscription, "pdf_transcription") },
  });

  await recordUsage({
    userId: input.userId,
    messageId: input.messageId,
    attachmentId: input.attachmentId,
    kind: "extract",
    model: env.AI_ENRICH_MODEL,
    seconds: 0,
    ...tokenUsage({ usage: res.usage, stage: "extract" }),
  });

  return res.output_parsed ? { ...res.output_parsed, truncated: false } : null;
}
