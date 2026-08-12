import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { env } from "../env.js";
import { openai } from "./openai.js";
import { recordUsage } from "./usage.js";

// Stage 2 for images (plan §7): one vision call returns a description plus
// any legible text (OCR) as structured output. Skipped (not failed) when
// OpenAI isn't configured or the image is too large to send.

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
  itemId: string;
}): Promise<ImageExtraction | null> {
  if (!openai || input.bytes.byteLength > MAX_VISION_BYTES) return null;

  const dataUrl = `data:${input.mime};base64,${Buffer.from(input.bytes).toString("base64")}`;
  const res = await openai.responses.parse({
    model: env.AI_ENRICH_MODEL,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "This image was dumped into a personal archive. Describe it for search: " +
              "a short title (max 8 words), a 1-3 sentence description, and any legible " +
              "text transcribed verbatim into ocr_text (empty string if none).",
          },
          { type: "input_image", image_url: dataUrl, detail: "auto" },
        ],
      },
    ],
    text: { format: zodTextFormat(ImageDescription, "image_description") },
  });

  await recordUsage({
    userId: input.userId,
    itemId: input.itemId,
    kind: "vision",
    model: env.AI_ENRICH_MODEL,
    inputTokens: res.usage?.input_tokens ?? 0,
    outputTokens: res.usage?.output_tokens ?? 0,
  });
  return res.output_parsed;
}
