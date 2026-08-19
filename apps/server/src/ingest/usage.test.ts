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

  it("prices the by-the-minute transcribers off their reported seconds", () => {
    // These report `usage.seconds` and no tokens at all, so pricing them on
    // tokens would put every voice note in the ledger at exactly zero.
    expect(costUsd("gpt-transcribe", 0, 0, 60)).toBeCloseTo(0.0045, 10);
    expect(costUsd("gpt-transcribe", 0, 0, 600)).toBeCloseTo(0.045, 10);
    expect(costUsd("whisper-1", 0, 0, 30)).toBeCloseTo(0.003, 10);
  });

  it("meters unknown models at zero cost instead of guessing", () => {
    expect(costUsd("some-future-model", 123_456, 789)).toBe(0);
  });
});
