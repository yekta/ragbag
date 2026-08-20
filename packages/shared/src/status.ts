// Ingestion state, shared by the Postgres schema, the Zero schema and the UI
// so all three spell it the same way.

/**
 * A message's status is denormalized by the worker from its parts, so the UI
 * reads one field (plan §5.6):
 *
 *   pending     nothing started
 *   processing  any part or synthesis running   -> "processing 2 of 3"
 *   done        every part done, synthesis done
 *   partial     synthesis done, at least one part failed
 *   failed      synthesis failed
 */
export const MESSAGE_STATUSES = ["pending", "processing", "done", "partial", "failed"] as const;
export type TMessageStatus = (typeof MESSAGE_STATUSES)[number];

export const ATTACHMENT_STATUSES = ["pending", "processing", "done", "failed"] as const;
export type TAttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];

/** Ingestion runs in two phases: each part on its own, then the whole message. */
export const INGEST_STAGES = ["attachment", "synthesis"] as const;
export type TIngestStage = (typeof INGEST_STAGES)[number];

export const JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export type TJobStatus = (typeof JOB_STATUSES)[number];

/**
 * Who put a mention on a message. `regex` and `ai` are ingestion's and get
 * replaced on every re-run; `user` is the owner's and never is.
 */
export const MENTION_SOURCES = ["regex", "ai", "user"] as const;
export type TMentionSource = (typeof MENTION_SOURCES)[number];

/** Which derivatives of an attachment's blob exist (plan §6.2). */
export type TBlobVariants = { display?: boolean; thumb?: boolean };

/** One line of a transcript (plan §8.5). */
export type TAudioSegment = { start: number; end: number; speaker?: string; text: string };
