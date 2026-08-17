import { describe, expect, it } from "vitest";
import { costUsd } from "./usage.js";

describe("costUsd", () => {
  it("prices gpt-5.6-luna at $0.20/M input + $1.20/M output", () => {
    expect(costUsd("gpt-5.6-luna", 1_000_000, 0)).toBeCloseTo(0.2, 10);
    expect(costUsd("gpt-5.6-luna", 0, 1_000_000)).toBeCloseTo(1.2, 10);
    expect(costUsd("gpt-5.6-luna", 5_000, 800)).toBeCloseTo(0.00196, 10);
  });

  it("prices the transcription model too, so audio shows up in the ledger", () => {
    expect(costUsd("gpt-4o-transcribe", 1_000_000, 0)).toBeCloseTo(2.5, 10);
  });

  it("meters unknown models at zero cost instead of guessing", () => {
    expect(costUsd("some-future-model", 123_456, 789)).toBe(0);
  });
});
