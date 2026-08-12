import { log } from "@ragbag/shared";
import { eq } from "drizzle-orm";
import { blobKey, storage } from "../blobs/storage.js";
import { db } from "../db/client.js";
import { blob, item, itemContent } from "../db/schema.js";
import { describeImage } from "./extract-image.js";
import { extractFromHtml } from "./extract-link.js";
import { extractPdfText } from "./extract-pdf.js";
import { applyAiTags, enrichItem, existingTopicNames } from "./enrich.js";
import { PermanentError, WaitingError } from "./errors.js";
import { NotHtmlError, fetchPage } from "./fetch-page.js";
import { indexItemText } from "./indexing.js";
import { openai } from "./openai.js";
import { underDailyBudget } from "./usage.js";

// The processor pipeline (plan §7): classify → extract → enrich → index.
// Every write here is a plain Postgres row; Zero replicates item_content and
// item_tag down to all devices, so enrichment appears live with no plumbing.

export { PermanentError, WaitingError } from "./errors.js";

/** extracted_text is truncated for clients (plan §4); chunks keep the rest. */
const SYNCED_TEXT_LIMIT = 8_000;

type ContentPatch = Partial<typeof itemContent.$inferInsert>;

async function patchContent(itemId: string, patch: ContentPatch) {
  await db.update(itemContent).set(patch).where(eq(itemContent.itemId, itemId));
}

async function loadBlobBytes(row: typeof item.$inferSelect): Promise<{
  bytes: Uint8Array;
  mime: string;
  originalName: string | null;
}> {
  if (!row.blobId) throw new PermanentError("item has no file attached");
  const blobRow = await db.query.blob.findFirst({ where: eq(blob.id, row.blobId) });
  if (!blobRow) {
    // The item synced before its capture device finished (or started) the
    // upload — normal with the offline queue. Try again later.
    throw new WaitingError("waiting for the file upload to start");
  }
  if (!storage) throw new PermanentError("server has no blob storage configured");
  const bytes = await storage.get(blobKey(row.userId, blobRow.sha256));
  if (!bytes) throw new WaitingError("waiting for the file upload to finish");
  return { bytes, mime: blobRow.mime, originalName: blobRow.originalName };
}

const TEXTUAL_FILE_RE =
  /^text\/|^application\/(json|xml|x-yaml|yaml|toml|javascript|typescript|x-sh|sql|csv)/;

export async function processJob(job: { itemId: string; userId: string }): Promise<void> {
  const row = await db.query.item.findFirst({ where: eq(item.id, job.itemId) });
  if (!row || row.deletedAt) return; // deleted while queued — nothing to do

  await patchContent(job.itemId, { status: "processing" });

  const patch: ContentPatch = {};
  let fullText = ""; // untruncated; chunked for search
  let isVideo = false;

  switch (row.kind) {
    case "note":
      break; // nothing to extract (plan §7)

    case "link": {
      try {
        const page = await fetchPage(row.url!);
        const extracted = extractFromHtml(page.html, page.finalUrl);
        patch.title = extracted.title ?? null;
        patch.description = extracted.description ?? null;
        patch.siteName = extracted.siteName ?? null;
        patch.faviconUrl = extracted.faviconUrl ?? null;
        patch.imageUrl = extracted.imageUrl ?? null;
        patch.lang = extracted.lang ?? null;
        fullText = extracted.extractedText;
        isVideo = extracted.isVideo;
        if (extracted.articleHtml && storage) {
          // Snapshot so the bookmark survives link rot (plan §7).
          await storage.put(
            `snapshots/${row.userId}/${row.id}.html`,
            new TextEncoder().encode(extracted.articleHtml),
            "text/html; charset=utf-8",
          );
        }
      } catch (err) {
        if (!(err instanceof NotHtmlError)) throw err;
        // A direct link to a file (image, PDF, …): keep it with basic metadata.
        const pathTail = new URL(row.url!).pathname.split("/").filter(Boolean).pop();
        patch.title = pathTail ?? row.url!;
        patch.description = `Direct link (${err.contentType})`;
      }
      break;
    }

    case "image": {
      const file = await loadBlobBytes(row);
      patch.title = file.originalName;
      if (openai && (await underDailyBudget(job.userId))) {
        const vision = await describeImage({
          bytes: file.bytes,
          mime: file.mime,
          userId: job.userId,
          itemId: job.itemId,
        });
        if (vision) {
          patch.title = vision.title || file.originalName;
          patch.description = vision.description || null;
          fullText = [vision.description, vision.ocr_text].filter(Boolean).join("\n\n");
        }
      }
      break;
    }

    case "pdf": {
      const file = await loadBlobBytes(row);
      patch.title = file.originalName;
      const pdf = await extractPdfText(file.bytes).catch((err) => {
        throw new PermanentError(
          `could not parse PDF: ${err instanceof Error ? err.message : err}`,
        );
      });
      if (pdf.text.length < 40) {
        throw new PermanentError(
          "PDF has no text layer (scanned?) — OCR for scanned PDFs isn't supported yet",
        );
      }
      fullText = pdf.text;
      break;
    }

    case "file": {
      const file = await loadBlobBytes(row);
      patch.title = file.originalName;
      if (TEXTUAL_FILE_RE.test(file.mime)) {
        fullText = new TextDecoder("utf-8", { fatal: false })
          .decode(file.bytes.slice(0, 400_000))
          .trim();
      }
      break;
    }
  }

  patch.extractedText = fullText ? fullText.slice(0, SYNCED_TEXT_LIMIT) : null;

  // Enrich (plan §7 stage 3) — skipped, never failed, when OpenAI is absent
  // or the user's rolling daily budget is exhausted.
  let budgetOk = false;
  if (openai) {
    budgetOk = await underDailyBudget(job.userId);
    if (budgetOk) {
      const enrichment = await enrichItem(
        {
          kind: row.kind,
          isVideo,
          url: row.url,
          title: patch.title,
          siteName: patch.siteName,
          description: patch.description,
          userText: row.text,
          extractedText: fullText,
          existingTopics: await existingTopicNames(job.userId),
        },
        { userId: job.userId, itemId: job.itemId },
      );
      if (enrichment) {
        await applyAiTags(enrichment, { userId: job.userId, itemId: job.itemId });
        patch.aiSummary = enrichment.summary;
        patch.lang = enrichment.lang || patch.lang || null;
      }
    } else {
      patch.error = "AI enrichment skipped: daily budget reached";
      log.warn("enrichment skipped: budget", { userId: job.userId, itemId: job.itemId });
    }
  }

  // Index (plan §7 stage 4): notes index their own text.
  const indexText = fullText || row.text || "";
  await indexItemText({
    userId: job.userId,
    itemId: job.itemId,
    text: indexText,
    mayEmbed: budgetOk,
  });

  await patchContent(job.itemId, {
    ...patch,
    status: "done",
    error: patch.error ?? null,
    processedAt: new Date(),
  });
}

/** Worker-side hooks for failure bookkeeping (kept here with the pipeline). */
export async function markContentPending(itemId: string, note: string): Promise<void> {
  await patchContent(itemId, { status: "pending", error: note });
}

export async function markContentFailed(itemId: string, error: string): Promise<void> {
  await patchContent(itemId, { status: "failed", error, processedAt: new Date() });
}
