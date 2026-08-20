import { describe, expect, it } from "vitest";
import { namedSpeakers, transcriptMarkdown } from "./extract-audio.js";
import {
  AI_MODEL_AUDIO_TRANSCRIPTION_AVAILABLE,
  AI_MODEL_AUDIO_TRANSCRIPTION_RESPONSE_FORMAT,
  chunkingStrategyFor,
} from "./models.js";

describe("transcription response format", () => {
  it("asks each model for the one shape it will answer in", () => {
    // Asking for the wrong one is a 400 that loses the call, not a downgrade.
    expect(AI_MODEL_AUDIO_TRANSCRIPTION_RESPONSE_FORMAT["gpt-transcribe"]).toBe("json");
  });

  it("names a format for every model that can be configured", () => {
    // `satisfies` enforces this at compile time; asserted here so that adding
    // a model and a format that disagree fails out loud rather than at a 400.
    for (const model of AI_MODEL_AUDIO_TRANSCRIPTION_AVAILABLE) {
      expect(AI_MODEL_AUDIO_TRANSCRIPTION_RESPONSE_FORMAT[model]).toBeTruthy();
    }
  });

  it("sends a chunking strategy only with the diarizing shape", () => {
    // Without it a diarizing model refuses any recording over 30 seconds;
    // with it, every other model refuses the call.
    expect(chunkingStrategyFor("diarized_json")).toEqual({ chunking_strategy: "auto" });
    expect(chunkingStrategyFor("json")).toEqual({});
    expect(chunkingStrategyFor("verbose_json")).toEqual({});
  });
});

describe("namedSpeakers", () => {
  it("keeps the labels when there is more than one voice", () => {
    const segments = [
      { start: 0, end: 1, speaker: "A", text: "hello" },
      { start: 1, end: 2, speaker: "B", text: "hi" },
    ];
    expect(namedSpeakers(segments)).toEqual(segments);
  });

  it("drops a label that would repeat down every line", () => {
    expect(
      namedSpeakers([
        { start: 0, end: 1, speaker: "A", text: "hello" },
        { start: 1, end: 2, speaker: "A", text: "still me" },
      ]),
    ).toEqual([
      { start: 0, end: 1, text: "hello" },
      { start: 1, end: 2, text: "still me" },
    ]);
  });
});

describe("transcriptMarkdown", () => {
  it("stamps every segment, and names the speaker when it knows one", () => {
    expect(
      transcriptMarkdown({
        segments: [
          { start: 0, end: 3.2, text: "morning" },
          { start: 63.5, end: 70, speaker: "B", text: "morning yourself" },
        ],
        fallback: "unused",
      }),
    ).toBe("[00:00] morning\n[01:03] B: morning yourself");
  });

  it("degrades to the plain text when the model returned no timings", () => {
    expect(transcriptMarkdown({ segments: [], fallback: "just the words then" })).toBe(
      "just the words then",
    );
  });
});
