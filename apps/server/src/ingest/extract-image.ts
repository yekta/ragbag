import { APIError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { env } from "../env.js";
import { PermanentError } from "./errors.js";
import { openai } from "./openai.js";
import { recordUsage } from "./usage.js";

// Phase A for images (plan §5.2): one vision call returns a description plus
// any legible text (OCR) as structured output, which the pipeline folds into
// the attachment's content_md. Skipped (not failed) when OpenAI isn't
// configured or the image is too large to send.

const ImageDescription = z.object({
  // A short human title for the card, e.g. "Whiteboard: Q3 roadmap".
  title: z.string(),
  description: z.string(),
  // Legible text transcribed verbatim; empty string when there is none.
  ocr_text: z.string(),
});

export type ImageExtraction = z.infer<typeof ImageDescription>;

const MAX_VISION_BYTES = 12 * 1024 * 1024;

export async function describeImage(input: {
  bytes: Uint8Array;
  mime: string;
  userId: string;
  messageId: string;
  attachmentId: string;
}): Promise<ImageExtraction | null> {
  if (!openai || input.bytes.byteLength > MAX_VISION_BYTES) return null;

  const dataUrl = `data:${input.mime};base64,${Buffer.from(input.bytes).toString("base64")}`;
  const res = await openai.responses
    .parse({
      model: env.AI_ENRICH_MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "This image was sent to a personal archive. Describe it for search: " +
                "a short title (max 8 words), a 1-3 sentence description, and any legible " +
                "text transcribed verbatim into ocr_text (empty string if none).",
            },
            { type: "input_image", image_url: dataUrl, detail: "auto" },
          ],
        },
      ],
      text: { format: zodTextFormat(ImageDescription, "image_description") },
    })
    .catch((err: unknown) => {
      // A 4xx means this image will never be accepted: corrupt bytes, an
      // unsupported format, too many pixels. Retrying burns quota and delays
      // the failure the user sees, so surface it immediately. 408/429 and all
      // 5xx stay retryable.
      if (err instanceof APIError && typeof err.status === "number") {
        const retryable = err.status === 408 || err.status === 429 || err.status >= 500;
        if (!retryable) {
          throw new PermanentError(`the image could not be read (${err.status}): ${err.message}`);
        }
      }
      throw err;
    });

  await recordUsage({
    userId: input.userId,
    messageId: input.messageId,
    attachmentId: input.attachmentId,
    kind: "vision",
    model: env.AI_ENRICH_MODEL,
    inputTokens: res.usage?.input_tokens ?? 0,
    outputTokens: res.usage?.output_tokens ?? 0,
  });
  return res.output_parsed;
}
