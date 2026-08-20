import { describe, expect, it } from "vitest";
import { costUsd, tokenUsage } from "./usage.js";

/** No tokens at all, so each test states only the counts it is about. */
const NO_TOKENS = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  seconds: 0,
};

describe("costUsd", () => {
  it("prices gpt-5.6-luna at $0.20/M input and $1.20/M output", () => {
    const model = "gpt-5.6-luna" as const;
    expect(costUsd({ ...NO_TOKENS, model, inputTokens: 1_000_000 })).toBeCloseTo(0.2, 10);
    expect(costUsd({ ...NO_TOKENS, model, outputTokens: 1_000_000 })).toBeCloseTo(1.2, 10);
    expect(costUsd({ ...NO_TOKENS, model, inputTokens: 5_000, outputTokens: 800 })).toBeCloseTo(
      0.00196,
      10,
    );
  });

  it("prices the step-up models off their own rate card", () => {
    const terra = "gpt-5.6-terra" as const;
    expect(costUsd({ ...NO_TOKENS, model: terra, inputTokens: 1_000_000 })).toBeCloseTo(2, 10);
    expect(costUsd({ ...NO_TOKENS, model: terra, outputTokens: 1_000_000 })).toBeCloseTo(12, 10);

    const sol = "gpt-5.6-sol" as const;
    expect(costUsd({ ...NO_TOKENS, model: sol, inputTokens: 1_000_000 })).toBeCloseTo(5, 10);
    expect(costUsd({ ...NO_TOKENS, model: sol, outputTokens: 1_000_000 })).toBeCloseTo(30, 10);
  });

  it("bills a cached token at a tenth of a fresh one", () => {
    // Billing every input token at the fresh rate is a 10x overstatement on
    // the cached share, which on a repeated prompt is most of it.
    const cached = costUsd({
      ...NO_TOKENS,
      model: "gpt-5.6-luna",
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
    });
    expect(cached).toBeCloseTo(0.02, 10);
    expect(cached * 10).toBeCloseTo(
      costUsd({ ...NO_TOKENS, model: "gpt-5.6-luna", inputTokens: 1_000_000 }),
      10,
    );
  });

  it("bills a written token at a 25% premium over a fresh one", () => {
    expect(
      costUsd({
        ...NO_TOKENS,
        model: "gpt-5.6-luna",
        inputTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      }),
    ).toBeCloseTo(0.25, 10);
  });

  it("splits the input count three ways rather than double-billing it", () => {
    // cached and written are both carved out of inputTokens, so 1000 input
    // with 600 read and 200 written leaves 200 at the fresh rate.
    expect(
      costUsd({
        ...NO_TOKENS,
        model: "gpt-5.6-luna",
        inputTokens: 1_000,
        cachedInputTokens: 600,
        cacheWriteTokens: 200,
      }),
    ).toBeCloseTo((200 * 0.2 + 600 * 0.02 + 200 * 0.25) / 1_000_000, 12);
  });

  it("never returns a refund when the shares do not add up", () => {
    // A negative fresh count would quietly credit the ledger. Clamped at zero
    // and logged instead, so an over-count reads as a warning, not a discount.
    expect(
      costUsd({
        ...NO_TOKENS,
        model: "gpt-5.6-luna",
        inputTokens: 100,
        cachedInputTokens: 80,
        cacheWriteTokens: 80,
      }),
    ).toBeCloseTo((80 * 0.02 + 80 * 0.25) / 1_000_000, 12);
  });

  it("prices transcription off the audio length, not off tokens", () => {
    // gpt-transcribe reports a duration and no token counts at all, so
    // pricing it on tokens would put every voice note in the ledger at zero.
    const model = "gpt-transcribe" as const;
    expect(costUsd({ ...NO_TOKENS, model, seconds: 60 })).toBeCloseTo(0.0045, 10);
    expect(costUsd({ ...NO_TOKENS, model, seconds: 600 })).toBeCloseTo(0.045, 10);
    expect(costUsd({ ...NO_TOKENS, model, seconds: 30 })).toBeCloseTo(0.00225, 10);
  });
});

describe("tokenUsage", () => {
  it("reads the cache breakdown the Responses API reports", () => {
    expect(
      tokenUsage({
        stage: "enrich",
        usage: {
          input_tokens: 1_000,
          output_tokens: 200,
          input_tokens_details: { cached_tokens: 600, cache_write_tokens: 150 },
        },
      }),
    ).toEqual({
      inputTokens: 1_000,
      cachedInputTokens: 600,
      cacheWriteTokens: 150,
      outputTokens: 200,
    });
  });

  it("fails the stage rather than metering a paid call as free", () => {
    // A completed response always carries usage, so its absence is a bug. A
    // $0.00 row is the one thing a spend ledger must never contain.
    expect(() => tokenUsage({ usage: undefined, stage: "vision" })).toThrow(/cannot be metered/);
    expect(() => tokenUsage({ usage: null, stage: "extract" })).toThrow(/no token usage/);
  });
});
