import { faceForMime, fenceLanguage, isTextualMime, log } from "@ragbag/shared";
import type { TAudioSegment } from "@ragbag/shared";
import { and, eq, sql as dsql } from "drizzle-orm";
import { blobKey, storage } from "../blobs/storage.js";
import { db } from "../db/client.js";
import { attachmentContents, attachments, blobs, messages } from "../db/schema.js";
import { buildImageDerivatives, storePageThumb } from "./derivatives.js";
import { AudioInputError } from "./audio-input.js";
import { transcribeAudio } from "./extract-audio.js";
import { describeImage } from "./extract-image.js";
import { extractPdfText, TEXT_LAYER_MIN_CHARS } from "./extract-pdf.js";
import { PdfTooLongError, transcribePdf } from "./extract-pdf-ocr.js";
import { PermanentError, WaitingError } from "./errors.js";
import { describeAiError, openai } from "./openai.js";
import { rasterizeFirstPage } from "./rasterize-pdf.js";
import { synthesizeMessage } from "./synthesis.js";

// Ingestion runs in two phases (plan §5). Phase A understands each attachment
// on its own; phase B reads the whole message and extracts entities. The
// worker claims one job of either stage; everything below is what a claimed
// job does.
//
// Every write here is a plain Postgres row; Zero replicates messages,
// attachments and attachment_contents down to every device, so extraction
// appears live with no plumbing of its own.

export { PermanentError, WaitingError } from "./errors.js";

/**
 * The per-attachment sync cap (plan §7). Past it the body is truncated and
 * `truncated` is set, so that attachment becomes partially searchable while
 * its title, summary and entities stay fully searchable. Never silent.
 */
export const CONTENT_LIMIT = 256 * 1024;

type TAttachmentPatch = Partial<typeof attachments.$inferInsert>;

async function patchAttachment(id: string, patch: TAttachmentPatch): Promise<void> {
  await db.update(attachments).set(patch).where(eq(attachments.id, id));
}

async function writeContent(
  attachmentId: string,
  contentMd: string,
  opts: { segments?: TAudioSegment[]; truncated?: boolean } = {},
): Promise<void> {
  // Two ways to be incomplete, and the column means either: the sync cap bit
  // here, or the extractor itself only read part of the document. Both are
  // reported rather than silent (plan §5.3, §5.2).
  const capped = contentMd.length > CONTENT_LIMIT;
  const truncated = capped || Boolean(opts.truncated);
  const body = capped ? contentMd.slice(0, CONTENT_LIMIT) : contentMd;
  const segments = opts.segments;
  await db
    .insert(attachmentContents)
    .values({ attachmentId, contentMd: body, truncated, segments })
    .onConflictDoUpdate({
      target: attachmentContents.attachmentId,
      set: { contentMd: body, truncated, segments: segments ?? null },
    });
}

export type TLoadedBlob = { bytes: Uint8Array; mime: string; sha256: string };

/**
 * The bytes behind an attachment.
 *
 * `blob_id` has no foreign key on purpose (plan §0.4.1): with the offline
 * upload queue a message syncs before its blob row exists. Both gaps are
 * WaitingError, which reschedules the job without burning an attempt.
 */
export async function loadBlobBytes(row: typeof attachments.$inferSelect): Promise<TLoadedBlob> {
  const blobRow = await db.query.blobs.findFirst({ where: eq(blobs.id, row.blobId) });
  if (!blobRow) throw new WaitingError("waiting for the file upload to start");
  if (!storage) throw new PermanentError("server has no blob storage configured");
  const bytes = await storage.get(blobKey(row.userId, blobRow.sha256));
  if (!bytes) throw new WaitingError("waiting for the file upload to finish");
  return { bytes, mime: blobRow.mime || row.mime, sha256: blobRow.sha256 };
}

/**
 * Phase A: understand one attachment on its own (plan §5.2).
 *
 * Every path produces the same `content_md` shape, so nothing downstream
 * (search, synthesis, the detail view) needs to know which one ran. The
 * format is the interface.
 */
export async function processAttachment(job: {
  messageId: string;
  attachmentId: string;
  userId: string;
}): Promise<void> {
  const row = await db.query.attachments.findFirst({ where: eq(attachments.id, job.attachmentId) });
  if (!row) return; // deleted while queued
  const message = await db.query.messages.findFirst({ where: eq(messages.id, row.messageId) });
  if (!message || message.deletedAt) return;

  await patchAttachment(row.id, { status: "processing" });
  await refreshMessageStatus(row.messageId);

  const patch: TAttachmentPatch = { generatedTitle: row.filename };
  // AI stages fail SOFT: extraction is never held hostage by OpenAI. Each
  // skipped or failed stage explains itself here and the note lands in the
  // row's `error` column with the status left usable, because a silent skip
  // looks exactly like a dead app (plan §0.4.2).
  const notes: string[] = [];
  let contentMd = "";
  let truncated = false;
  let segments: TAudioSegment[] | undefined;

  switch (faceForMime(row.mime)) {
    case "image": {
      const file = await loadBlobBytes(row);

      // Derivatives first: they are what the browser actually renders, and a
      // HEIC that never transcodes is a picture nothing but Safari can open.
      try {
        const derived = await buildImageDerivatives({
          bytes: file.bytes,
          userId: row.userId,
          sha256: file.sha256,
        });
        patch.width = derived.width || row.width;
        patch.height = derived.height || row.height;
        patch.variants = derived.variants;
        patch.placeholder = derived.placeholder;
      } catch (err) {
        // Soft, like every other stage: the original still uploads, still
        // downloads and still opens in anything that can read it. The usual
        // cause is a libvips without libheif (see derivatives.ts).
        notes.push(`couldn't make web-sized copies of this image: ${describeError(err)}`);
        log.warn("derivatives failed; keeping the original only", {
          attachmentId: row.id,
          err: String(err),
        });
      }

      if (!openai) {
        notes.push(
          "AI is off on this server (no OpenAI API key), so this image has no description",
        );
        break;
      }
      try {
        const vision = await describeImage({
          bytes: file.bytes,
          mime: file.mime,
          userId: job.userId,
          messageId: job.messageId,
          attachmentId: row.id,
        });
        if (vision) {
          patch.generatedTitle = vision.title || row.filename;
          patch.generatedSummary = vision.description || null;
          contentMd = imageContentMd(vision.description, vision.ocr_text);
        }
      } catch (err) {
        // The image itself is fine (it renders from the blob); only the
        // description is missing, and the note says why.
        notes.push(`AI image description failed: ${describeAiError(err)}`);
        log.warn("vision failed; keeping the image without a description", {
          attachmentId: row.id,
          err: String(err),
        });
      }
      break;
    }

    case "pdf": {
      const file = await loadBlobBytes(row);
      const pdf = await extractPdfText(file.bytes).catch((err: unknown) => {
        // Only a genuinely unreadable file is permanent now: corrupt bytes,
        // or encrypted with no password.
        throw new PermanentError(
          `could not parse PDF: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      contentMd = pdf.markdown;

      // Local text layer first, then hand the whole file to the model. The
      // common case costs nothing at all; a scan is the expensive one, which
      // is why it is bounded rather than merely attempted (plan §5.2).
      if (pdf.text.length < TEXT_LAYER_MIN_CHARS) {
        if (!openai) {
          notes.push(
            "this PDF has no text layer (a scan?) and AI is off on this server, so nothing was read from it",
          );
        } else {
          try {
            const read = await transcribePdf({
              bytes: file.bytes,
              filename: row.filename,
              numPages: pdf.numPages,
              userId: job.userId,
              messageId: job.messageId,
              attachmentId: row.id,
            });
            if (read) {
              patch.generatedTitle = read.title || row.filename;
              patch.generatedSummary = read.summary || null;
              contentMd = read.content_md;
              truncated = read.truncated;
            }
          } catch (err) {
            // Never silent: the page cap and every other failure land on the
            // row, and whatever text layer existed is kept regardless.
            notes.push(
              err instanceof PdfTooLongError
                ? err.message
                : `reading this scanned PDF failed: ${describeAiError(err)}`,
            );
            log.warn("scanned-PDF pass failed; keeping the text layer", {
              attachmentId: row.id,
              pages: pdf.numPages,
              err: String(err),
            });
          }
        }
      }

      // The grid needs a picture, and nothing else produces one for a PDF.
      // Purely cosmetic, so it never affects the outcome of the job.
      try {
        const png = await rasterizeFirstPage(file.bytes);
        if (png) {
          const thumb = await storePageThumb({
            png,
            userId: row.userId,
            sha256: file.sha256,
          });
          patch.variants = thumb.variants;
          patch.placeholder = thumb.placeholder;
        }
      } catch (err) {
        log.debug("could not render a PDF thumbnail", {
          attachmentId: row.id,
          err: String(err),
        });
      }
      break;
    }

    case "audio": {
      if (!openai) {
        notes.push(
          "AI is off on this server (no OpenAI API key), so this recording was not transcribed",
        );
        break;
      }
      const file = await loadBlobBytes(row);
      try {
        const heard = await transcribeAudio({
          bytes: file.bytes,
          filename: row.filename,
          mime: file.mime,
          userId: job.userId,
          messageId: job.messageId,
          attachmentId: row.id,
        });
        if (heard) {
          patch.generatedSummary = heard.summary || null;
          contentMd = heard.contentMd;
          // Only the models that time their output give segments; with the
          // others the transcript is a paragraph and the column stays null
          // rather than syncing an empty array to every device.
          segments = heard.segments.length > 0 ? heard.segments : undefined;
        }
      } catch (err) {
        // The recording still plays, and the note says why there are no words
        // to search: soft, like every other AI stage (plan §0.4.2).
        notes.push(
          err instanceof AudioInputError
            ? err.message
            : `transcription failed: ${describeAiError(err)}`,
        );
        log.warn("transcription failed; keeping the recording", {
          attachmentId: row.id,
          err: String(err),
        });
      }
      break;
    }

    case "file": {
      const file = await loadBlobBytes(row);
      if (isTextualMime(file.mime)) {
        const text = new TextDecoder("utf-8", { fatal: false })
          .decode(file.bytes.slice(0, CONTENT_LIMIT))
          .trim();
        if (text) contentMd = fencedContentMd(text, file.mime, row.filename);
      }
      break;
    }
  }

  if (contentMd) await writeContent(row.id, contentMd, { truncated, segments });
  await patchAttachment(row.id, {
    ...patch,
    status: "done",
    error: notes.length > 0 ? notes.join(" · ") : null,
  });
  await refreshMessageStatus(row.messageId);
}

/** A non-AI failure, in words the detail view can show. */
function describeError(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}

/** The image shape of `content_md` (plan §5.3). */
export function imageContentMd(description: string, ocr: string): string {
  const parts: string[] = [];
  if (description.trim()) parts.push(`## What this shows\n\n${description.trim()}`);
  if (ocr.trim()) parts.push(`## Text in the image\n\n${ocr.trim()}`);
  return parts.join("\n\n");
}

/** The textual-file shape: the bytes, fenced, so markdown does not eat them. */
export function fencedContentMd(text: string, mime: string, filename: string): string {
  const lang = fenceLanguage(mime, filename);
  // A fence long enough to survive whatever fences the file itself contains.
  const longest = [...text.matchAll(/^`{3,}/gm)].reduce((n, m) => Math.max(n, m[0].length), 2);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${text}\n${fence}`;
}

/**
 * Phase B: read the whole message and extract entities (plan §5.4).
 *
 * Waits for its own parts first. The check is a throw rather than a
 * dependency graph: WaitingError is what the worker already treats as
 * "reschedule without burning an attempt", which is the same mechanism that
 * handles a blob that has not been uploaded yet.
 */
export async function processSynthesis(job: { messageId: string; userId: string }): Promise<void> {
  const message = await db.query.messages.findFirst({ where: eq(messages.id, job.messageId) });
  if (!message || message.deletedAt) return;

  const [pending] = await db
    .select({ count: dsql<number>`count(*)::int` })
    .from(attachments)
    .where(
      and(
        eq(attachments.messageId, job.messageId),
        dsql`${attachments.status} in ('pending', 'processing')`,
      ),
    );
  if ((pending?.count ?? 0) > 0) {
    throw new WaitingError(`waiting for ${pending!.count} attachment(s) to finish`);
  }

  await db.update(messages).set({ status: "processing" }).where(eq(messages.id, job.messageId));

  const notes = await synthesizeMessage({ messageId: job.messageId, userId: job.userId });

  await db
    .update(messages)
    .set({
      error: notes.length > 0 ? notes.join(" · ") : null,
      processedAt: new Date(),
    })
    .where(eq(messages.id, job.messageId));
  await refreshMessageStatus(job.messageId, { synthesis: "done" });
}

/**
 * Denormalize the message's status from its parts, so the UI reads one field
 * (plan §5.6). Called after every job; the "2 of 3" in the chip comes from
 * the attachment rows themselves, which are synced.
 */
export async function refreshMessageStatus(
  messageId: string,
  outcome?: { synthesis: "done" | "failed" },
): Promise<void> {
  const [counts] = await db
    .select({
      parts: dsql<number>`count(*)::int`,
      failed: dsql<number>`count(*) filter (where ${attachments.status} = 'failed')::int`,
      running: dsql<number>`count(*) filter (where ${attachments.status} = 'processing')::int`,
      pending: dsql<number>`count(*) filter (where ${attachments.status} = 'pending')::int`,
    })
    .from(attachments)
    .where(eq(attachments.messageId, messageId));

  const synthesis =
    outcome?.synthesis ??
    (
      await db.query.ingestJobs.findFirst({
        where: (jobs, { and: andWhere, eq: eqWhere, isNull }) =>
          andWhere(
            eqWhere(jobs.messageId, messageId),
            eqWhere(jobs.stage, "synthesis"),
            isNull(jobs.attachmentId),
          ),
      })
    )?.status;

  const failedParts = counts?.failed ?? 0;
  let status: (typeof messages.$inferInsert)["status"];
  if (synthesis === "failed") status = "failed";
  else if (synthesis === "done") status = failedParts > 0 ? "partial" : "done";
  else if ((counts?.running ?? 0) > 0 || synthesis === "running") status = "processing";
  else if ((counts?.pending ?? 0) === (counts?.parts ?? 0) && synthesis === "queued")
    status = "pending";
  else status = "processing";

  await db.update(messages).set({ status }).where(eq(messages.id, messageId));
}

/** Worker-side hooks for failure bookkeeping (kept here with the pipeline). */
export async function markAttachmentFailed(attachmentId: string, error: string): Promise<void> {
  await patchAttachment(attachmentId, { status: "failed", error });
}

export async function markAttachmentPending(attachmentId: string, note: string): Promise<void> {
  await patchAttachment(attachmentId, { status: "pending", error: note });
}

export async function markMessageFailed(messageId: string, error: string): Promise<void> {
  await db
    .update(messages)
    .set({ status: "failed", error, processedAt: new Date() })
    .where(eq(messages.id, messageId));
}
