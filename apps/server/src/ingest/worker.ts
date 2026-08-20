import { log } from "@ragbag/shared";
import type { TIngestStage } from "@ragbag/shared";
import { sql } from "../db/client.js";
import { env } from "../env.js";
import {
  PermanentError,
  WaitingError,
  markAttachmentFailed,
  markAttachmentPending,
  markMessageFailed,
  processAttachment,
  processSynthesis,
  refreshMessageStatus,
} from "./pipeline.js";

// The Postgres-backed job queue's consumer (plan §5.1): claim with
// FOR UPDATE SKIP LOCKED, wake instantly via LISTEN/NOTIFY, poll as a
// fallback. Runs inside the API process for now; INGEST_WORKER=false turns it
// off when a dedicated worker instance takes over.

const POLL_INTERVAL_MS = 5_000;
/** A 'running' job untouched this long is presumed crashed and reclaimed. */
const STALE_RUNNING_MINUTES = 10;
/** Real processing attempts before a job is marked failed. */
const MAX_ATTEMPTS = 4;
/** How long to keep waiting for an offline device to upload its blob. */
const BLOB_WAIT_MAX_SECONDS = 7 * 24 * 60 * 60;

type TClaimedJob = {
  id: string;
  messageId: string;
  attachmentId: string | null;
  stage: TIngestStage;
  userId: string;
  attempts: number;
  /** True once this job has waited longer than a blob upload is worth. */
  waitExpired: boolean;
};

let lastLoopAt = 0;

/** Debug surface: is the worker on, and when did a loop last look for work. */
export function ingestHeartbeat(): { enabled: boolean; lastLoopAt: number } {
  return { enabled: env.INGEST_WORKER, lastLoopAt };
}

async function claimJob(): Promise<TClaimedJob | null> {
  // The wait deadline is evaluated in SQL on purpose: raw queries through
  // this client return timestamps as strings (drizzle/zero replace
  // postgres.js's date parsers), so JS-side date math on them is a trap.
  //
  // `order by run_after` alone is enough to keep the two stages honest: a
  // synthesis job whose parts are still running reschedules itself five
  // minutes out, so it drops behind them rather than spinning.
  const rows = await sql<
    {
      id: string;
      message_id: string;
      attachment_id: string | null;
      stage: TIngestStage;
      user_id: string;
      attempts: number;
      wait_expired: boolean;
    }[]
  >`
    update ingest_jobs set status = 'running', attempts = attempts + 1, updated_at = now()
    where id = (
      select id from ingest_jobs
      where (status = 'queued' and run_after <= now())
         or (status = 'running' and updated_at < now() - make_interval(mins => ${STALE_RUNNING_MINUTES}))
      order by run_after
      limit 1
      for update skip locked
    )
    returning id, message_id, attachment_id, stage, user_id, attempts,
      (created_at < now() - make_interval(secs => ${BLOB_WAIT_MAX_SECONDS})) as wait_expired`;
  const row = rows[0];
  return row
    ? {
        id: row.id,
        messageId: row.message_id,
        attachmentId: row.attachment_id,
        stage: row.stage,
        userId: row.user_id,
        attempts: row.attempts,
        waitExpired: row.wait_expired,
      }
    : null;
}

function backoffMs(attempts: number): number {
  // 30s, 2m, 8m, 32m…
  return Math.min(30_000 * 4 ** (attempts - 1), 2 * 60 * 60 * 1000);
}

/** What a failure of this job means for the row the UI is watching. */
async function noteFailure(job: TClaimedJob, message: string): Promise<void> {
  if (job.stage === "attachment" && job.attachmentId) {
    await markAttachmentFailed(job.attachmentId, message);
    await refreshMessageStatus(job.messageId);
  } else {
    await markMessageFailed(job.messageId, message);
  }
}

async function notePending(job: TClaimedJob, message: string): Promise<void> {
  if (job.stage === "attachment" && job.attachmentId) {
    await markAttachmentPending(job.attachmentId, message);
  }
  await refreshMessageStatus(job.messageId);
}

async function runJob(job: TClaimedJob): Promise<void> {
  const started = Date.now();
  try {
    if (job.stage === "attachment") {
      if (!job.attachmentId) throw new PermanentError("attachment job with no attachment");
      await processAttachment({
        messageId: job.messageId,
        attachmentId: job.attachmentId,
        userId: job.userId,
      });
    } else {
      await processSynthesis({ messageId: job.messageId, userId: job.userId });
    }
    await sql`update ingest_jobs set status = 'done', last_error = null, updated_at = now()
              where id = ${job.id}`;
    log.info("ingested", {
      messageId: job.messageId,
      stage: job.stage,
      ms: Date.now() - started,
    });
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);

    if (err instanceof WaitingError) {
      if (job.waitExpired) {
        await failJob(job, "the file upload never arrived");
        return;
      }
      // Not the job's fault: reschedule without burning an attempt. This is
      // both the blob-still-uploading case and synthesis waiting on its own
      // parts (plan §5.1), which is why it needs no dependency graph.
      await sql`update ingest_jobs
                set status = 'queued', attempts = ${job.attempts - 1},
                    run_after = now() + interval '30 seconds',
                    last_error = ${message}, updated_at = now()
                where id = ${job.id}`;
      await notePending(job, message);
      log.debug("ingest waiting", { messageId: job.messageId, reason: message });
      return;
    }

    if (err instanceof PermanentError || job.attempts >= MAX_ATTEMPTS) {
      await failJob(job, message);
      return;
    }

    const delay = backoffMs(job.attempts);
    await sql`update ingest_jobs
              set status = 'queued', run_after = now() + make_interval(secs => ${delay / 1000}),
                  last_error = ${message}, updated_at = now()
              where id = ${job.id}`;
    await notePending(job, `retrying: ${message}`);
    log.warn("ingest retry scheduled", {
      messageId: job.messageId,
      stage: job.stage,
      attempt: job.attempts,
      delayMs: delay,
      err: message,
    });
  }
}

async function failJob(job: TClaimedJob, message: string): Promise<void> {
  await sql`update ingest_jobs set status = 'failed', last_error = ${message}, updated_at = now()
            where id = ${job.id}`;
  await noteFailure(job, message);
  log.error("ingest failed", {
    messageId: job.messageId,
    stage: job.stage,
    attempts: job.attempts,
    err: message,
  });
}

export function startIngestWorker(): () => Promise<void> {
  if (!env.INGEST_WORKER) {
    log.info("ingest worker disabled (INGEST_WORKER=false)");
    return () => Promise.resolve();
  }

  // Held in an object so the loops below and the returned stopper share it.
  const state = { stopping: false };
  let wake: (() => void) | null = null;
  const wakeUp = () => {
    wake?.();
    wake = null;
  };

  // NOTIFY from message.create/retry makes new messages process instantly; if
  // LISTEN fails we still poll.
  void sql.listen("ingest_wake", wakeUp).catch((err: unknown) => {
    log.warn("LISTEN ingest_wake failed; falling back to polling", { err: String(err) });
  });

  const loops = Array.from({ length: env.INGEST_CONCURRENCY }, async (_, n) => {
    log.info("ingest worker loop started", { n });
    while (!state.stopping) {
      lastLoopAt = Date.now();
      let job: TClaimedJob | null = null;
      try {
        job = await claimJob();
      } catch (err) {
        log.error("ingest claim failed", { err: String(err) });
      }
      if (job) {
        try {
          await runJob(job);
        } catch (err) {
          // runJob handles its own failures; reaching here means the failure
          // HANDLING itself threw. Never let that take down the API server:
          // release the job so it isn't stranded in 'running' and carry on.
          const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
          log.error("ingest handler crashed; releasing job", {
            messageId: job.messageId,
            err: message,
          });
          await sql`
            update ingest_jobs
            set status = 'queued', run_after = now() + interval '1 minute',
                last_error = ${`handler crashed: ${message}`}, updated_at = now()
            where id = ${job.id}`.catch(() => {});
        }
      } else {
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, POLL_INTERVAL_MS);
        });
      }
    }
  });

  return async () => {
    state.stopping = true;
    wakeUp();
    await Promise.all(loops);
    log.info("ingest worker stopped");
  };
}
