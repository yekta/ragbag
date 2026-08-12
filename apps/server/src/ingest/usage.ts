import { log, newId } from "@ragbag/shared";
import { and, gte, eq, sum } from "drizzle-orm";
import { db } from "../db/client.js";
import { aiUsage } from "../db/schema.js";
import { env } from "../env.js";

// Per-user AI-spend metering + caps from day one (plan §7/§11): every OpenAI
// call is priced and recorded; enrichment is skipped (not failed) once a
// user's rolling-24h spend crosses AI_USER_DAILY_BUDGET_USD.

/** USD per million tokens. */
const PRICES: Record<string, { input: number; output: number }> = {
  // OpenAI's fastest/cheapest tier — the right fit for high-volume tagging (§7).
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  // Embeddings bill input only (§8).
  "text-embedding-3-small": { input: 0.02, output: 0 },
};

const unknownModels = new Set<string>();

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[model];
  if (!price) {
    if (!unknownModels.has(model)) {
      unknownModels.add(model);
      log.warn("no price entry for model; metering tokens with zero cost", { model });
    }
    return 0;
  }
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export async function recordUsage(entry: {
  userId: string;
  itemId?: string;
  kind: "enrich" | "vision" | "embed";
  model: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  await db.insert(aiUsage).values({
    id: newId(),
    userId: entry.userId,
    itemId: entry.itemId,
    kind: entry.kind,
    model: entry.model,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    costUsd: costUsd(entry.model, entry.inputTokens, entry.outputTokens),
  });
}

export async function spentLast24h(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(aiUsage.costUsd) })
    .from(aiUsage)
    .where(
      and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, new Date(Date.now() - 86_400_000))),
    );
  return Number(row?.total ?? 0);
}

export async function underDailyBudget(userId: string): Promise<boolean> {
  return (await spentLast24h(userId)) < env.AI_USER_DAILY_BUDGET_USD;
}
