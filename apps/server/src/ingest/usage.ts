import { log, newId } from "@ragbag/shared";
import { and, gte, eq, sum } from "drizzle-orm";
import { db } from "../db/client.js";
import { aiUsageEvents } from "../db/schema.js";
import { PermanentError } from "./errors.js";
import {
  AI_MODEL_AUDIO_TRANSCRIPTION_PRICES_USD,
  AI_MODEL_LLM_PRICES_USD,
  SECONDS_PER_PRICE_UNIT,
  TOKENS_PER_PRICE_UNIT,
  type TAiModelAudioTranscription,
  type TAiModelLlm,
} from "./models.js";

// Per-user AI-spend metering: every OpenAI call is priced and recorded, so
// spend is auditable after the fact. Recording only: nothing here gates
// ingestion. (There used to be a rolling-24h cap that silently skipped
// enrichment; a stage that quietly does nothing is exactly the failure mode
// this app keeps getting bitten by, and v2 costs several times more per
// message, so the ledger matters more, not less. Plan §14.2.)
//
// Nothing in this file has a zero fallback. The model is one of the enums in
// models.ts, so every branch has a price; the token counts are required, so
// an omitted one is a compile error; and a response that arrives without
// `usage` fails the stage instead of writing a $0.00 row for a call that
// really cost money. A ledger that under-reports is worse than no ledger.

export type TUsageKind = "vision" | "transcribe" | "enrich" | "extract";

export type TAiModel = TAiModelLlm | TAiModelAudioTranscription;

/** Token counts as the Responses API reports them. */
export type TTokenUsage = {
  inputTokens: number;
  /** Read back out of the prompt cache. A subset of `inputTokens`. */
  cachedInputTokens: number;
  /** Written into the prompt cache. Also a subset of `inputTokens`. */
  cacheWriteTokens: number;
  outputTokens: number;
};

function isAudioModel(model: TAiModel): model is TAiModelAudioTranscription {
  return model in AI_MODEL_AUDIO_TRANSCRIPTION_PRICES_USD;
}

export function costUsd(input: TTokenUsage & { model: TAiModel; seconds: number }): number {
  if (isAudioModel(input.model)) {
    const { perMinute } = AI_MODEL_AUDIO_TRANSCRIPTION_PRICES_USD[input.model];
    return (input.seconds / SECONDS_PER_PRICE_UNIT) * perMinute;
  }

  const price = AI_MODEL_LLM_PRICES_USD[input.model];
  // Cached and written tokens are both carved out of `inputTokens` and billed
  // at their own rates, so the three shares partition the input. If they ever
  // stop adding up, say so: a negative share would quietly refund the row.
  const fresh = input.inputTokens - input.cachedInputTokens - input.cacheWriteTokens;
  if (fresh < 0) {
    log.warn("cached + written tokens exceed the input count; pricing the remainder at zero", {
      model: input.model,
      inputTokens: input.inputTokens,
      cachedInputTokens: input.cachedInputTokens,
      cacheWriteTokens: input.cacheWriteTokens,
    });
  }
  const usd =
    Math.max(0, fresh) * price.input +
    input.cachedInputTokens * price.cachedInput +
    input.cacheWriteTokens * price.cacheWrite +
    input.outputTokens * price.output;
  return usd / TOKENS_PER_PRICE_UNIT;
}

/**
 * Token counts off a Responses API result, or a hard failure.
 *
 * `usage` is optional on the SDK type but always present on a completed
 * response, so its absence is a bug here rather than something a retry would
 * fix, and the call has already been paid for either way. Failing the stage
 * puts the reason on the row; the alternative is a free-looking row in a
 * spend ledger, which is the one thing it must never contain.
 */
export function tokenUsage(input: {
  usage:
    | {
        input_tokens: number;
        output_tokens: number;
        input_tokens_details: { cached_tokens: number; cache_write_tokens: number };
      }
    | null
    | undefined;
  stage: TUsageKind;
}): TTokenUsage {
  if (!input.usage) {
    throw new PermanentError(
      `OpenAI returned no token usage for the ${input.stage} call, so it cannot be metered`,
    );
  }
  return {
    inputTokens: input.usage.input_tokens,
    cachedInputTokens: input.usage.input_tokens_details.cached_tokens,
    cacheWriteTokens: input.usage.input_tokens_details.cache_write_tokens,
    outputTokens: input.usage.output_tokens,
  };
}

export async function recordUsage(
  entry: TTokenUsage & {
    userId: string;
    messageId?: string | null;
    attachmentId?: string | null;
    kind: TUsageKind;
    model: TAiModel;
    /** Audio length billed, for the models priced by the minute. */
    seconds: number;
  },
): Promise<void> {
  await db.insert(aiUsageEvents).values({
    id: newId(),
    userId: entry.userId,
    messageId: entry.messageId ?? null,
    attachmentId: entry.attachmentId ?? null,
    kind: entry.kind,
    model: entry.model,
    inputTokens: entry.inputTokens,
    cachedInputTokens: entry.cachedInputTokens,
    cacheWriteTokens: entry.cacheWriteTokens,
    outputTokens: entry.outputTokens,
    costUsd: costUsd(entry),
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
