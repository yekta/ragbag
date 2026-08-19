import { log, newId } from "@ragbag/shared";
import { and, gte, eq, sum } from "drizzle-orm";
import { db } from "../db/client.js";
import { aiUsageEvents } from "../db/schema.js";

// Per-user AI-spend metering: every OpenAI call is priced and recorded, so
// spend is auditable after the fact. Recording only: nothing here gates
// ingestion. (There used to be a rolling-24h cap that silently skipped
// enrichment; a stage that quietly does nothing is exactly the failure mode
// this app keeps getting bitten by, and v2 costs several times more per
// message, so the ledger matters more, not less. Plan §14.2.)

export type UsageKind = "vision" | "transcribe" | "enrich" | "extract";

/** USD per million tokens. */
const PRICES: Record<string, { input: number; output: number }> = {
  // OpenAI's fastest/cheapest tier, the right fit for high-volume tagging.
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "gpt-4o-transcribe": { input: 2.5, output: 10 },
  "gpt-4o-mini-transcribe": { input: 1.25, output: 5 },
  // Same rate card as gpt-4o-transcribe, but it emits a segment per phrase,
  // so the output side is what costs: about $0.02 a minute of audio, four
  // times the default model, which is what buys the timings and the speakers.
  "gpt-4o-transcribe-diarize": { input: 2.5, output: 10 },
};

/**
 * USD per minute, for the transcription models billed by how long the
 * recording is instead of by tokens. They report `usage.seconds` rather than
 * a token count, so pricing them off tokens would meter every voice note in
 * the archive at exactly zero.
 */
const AUDIO_PRICES: Record<string, number> = {
  "gpt-transcribe": 0.0045,
  "whisper-1": 0.006,
};

const unknownModels = new Set<string>();

export function costUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  seconds = 0,
): number {
  const price = PRICES[model];
  if (price) return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;

  const perMinute = AUDIO_PRICES[model];
  if (perMinute !== undefined) return (seconds / 60) * perMinute;

  if (!unknownModels.has(model)) {
    unknownModels.add(model);
    log.warn("no price entry for model; metering tokens with zero cost", { model });
  }
  return 0;
}

export async function recordUsage(entry: {
  userId: string;
  messageId?: string | null;
  attachmentId?: string | null;
  kind: UsageKind;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Audio length billed, for the models priced by the minute. */
  seconds?: number;
}): Promise<void> {
  await db.insert(aiUsageEvents).values({
    id: newId(),
    userId: entry.userId,
    messageId: entry.messageId ?? null,
    attachmentId: entry.attachmentId ?? null,
    kind: entry.kind,
    model: entry.model,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    costUsd: costUsd(entry.model, entry.inputTokens, entry.outputTokens, entry.seconds ?? 0),
  });
}

/** What this user's AI calls have cost in the last 24h (reporting only). */
export async function spentLast24h(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(aiUsageEvents.costUsd) })
    .from(aiUsageEvents)
    .where(
      and(
        eq(aiUsageEvents.userId, userId),
        gte(aiUsageEvents.createdAt, new Date(Date.now() - 86_400_000)),
      ),
    );
  return Number(row?.total ?? 0);
}
