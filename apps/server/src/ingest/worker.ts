import { log } from "@ragbag/shared";
import { sql } from "../db/client.js";
import { env } from "../env.js";
import { ensureVectorColumn } from "./indexing.js";
import {
  PermanentError,
  WaitingError,
  markContentFailed,
  markContentPending,
  processJob,
} from "./pipeline.js";

// The Postgres-backed job queue's consumer (plan §5): claim with
// FOR UPDATE SKIP LOCKED, wake instantly via LISTEN/NOTIFY, poll as a
// fallback. Runs inside the API process for now; INGEST_WORKER=false turns it
// off when a dedicated worker instance takes over (plan §11).

const POLL_INTERVAL_MS = 5_000;
/** A 'running' job untouched this long is presumed crashed and reclaimed. */
const STALE_RUNNING_MINUTES = 10;
/** Real processing attempts before a job is marked failed. */
const MAX_ATTEMPTS = 4;
/** How long to keep waiting for an offline device to upload its blob. */
const BLOB_WAIT_MAX_MS = 7 * 24 * 60 * 60 * 1000;

type ClaimedJob = {
  id: string;
  itemId: string;
  userId: string;
  attempts: number;
  createdAt: Date;
};

async function claimJob(): Promise<ClaimedJob | null> {
  const rows = await sql<
    { id: string; item_id: string; user_id: string; attempts: number; created_at: Date }[]
  >`
    update ingest_job set status = 'running', attempts = attempts + 1, updated_at = now()
    where id = (
      select id from ingest_job
      where (status = 'queued' and run_after <= now())
         or (status = 'running' and updated_at < now() - make_interval(mins => ${STALE_RUNNING_MINUTES}))
      order by run_after
      limit 1
      for update skip locked
    )
    returning id, item_id, user_id, attempts, created_at`;
  const row = rows[0];
  return row
    ? {
        id: row.id,
        itemId: row.item_id,
        userId: row.user_id,
        attempts: row.attempts,
        createdAt: row.created_at,
      }
    : null;
}

function backoffMs(attempts: number): number {
  // 30s, 2m, 8m, 32m…
  return Math.min(30_000 * 4 ** (attempts - 1), 2 * 60 * 60 * 1000);
}

async function runJob(job: ClaimedJob): Promise<void> {
  const started = Date.now();
  try {
    await processJob(job);
    await sql`update ingest_job set status = 'done', last_error = null, updated_at = now()
              where id = ${job.id}`;
    log.info("ingested", { itemId: job.itemId, ms: Date.now() - started });
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);

    if (err instanceof WaitingError) {
      if (Date.now() - job.createdAt.getTime() > BLOB_WAIT_MAX_MS) {
        await failJob(job, "the file upload never arrived");
        return;
      }
      // Not the job's fault — reschedule without burning an attempt.
      await sql`update ingest_job
                set status = 'queued', attempts = ${job.attempts - 1},
                    run_after = now() + interval '5 minutes',
                    last_error = ${message}, updated_at = now()
                where id = ${job.id}`;
      await markContentPending(job.itemId, message);
      log.debug("ingest waiting", { itemId: job.itemId, reason: message });
      return;
    }

    if (err instanceof PermanentError || job.attempts >= MAX_ATTEMPTS) {
      await failJob(job, message);
      return;
    }

    const delay = backoffMs(job.attempts);
    await sql`update ingest_job
              set status = 'queued', run_after = now() + make_interval(secs => ${delay / 1000}),
                  last_error = ${message}, updated_at = now()
              where id = ${job.id}`;
    await markContentPending(job.itemId, `retrying: ${message}`);
    log.warn("ingest retry scheduled", {
      itemId: job.itemId,
      attempt: job.attempts,
      delayMs: delay,
      err: message,
    });
  }
}

async function failJob(job: ClaimedJob, message: string): Promise<void> {
  await sql`update ingest_job set status = 'failed', last_error = ${message}, updated_at = now()
            where id = ${job.id}`;
  await markContentFailed(job.itemId, message);
  log.error("ingest failed", { itemId: job.itemId, attempts: job.attempts, err: message });
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

  void ensureVectorColumn().catch((err) =>
    log.warn("could not ensure pgvector column", { err: String(err) }),
  );
  // NOTIFY from createItem/retryIngest makes new dumps process instantly;
  // if LISTEN fails we still poll.
  void sql.listen("ingest_wake", wakeUp).catch((err) => {
    log.warn("LISTEN ingest_wake failed; falling back to polling", { err: String(err) });
  });

  const loops = Array.from({ length: env.INGEST_CONCURRENCY }, async (_, n) => {
    log.info("ingest worker loop started", { n });
    while (!state.stopping) {
      let job: ClaimedJob | null = null;
      try {
        job = await claimJob();
      } catch (err) {
        log.error("ingest claim failed", { err: String(err) });
      }
      if (job) {
        await runJob(job);
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
