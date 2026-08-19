import { describe, expect, it } from "vitest";
import { namedSpeakers, responseFormatFor, transcriptMarkdown } from "./extract-audio.js";

describe("responseFormatFor", () => {
  it("asks each model for the one shape it will answer in", () => {
    // Asking for the wrong one is a 400 that loses the call, not a downgrade.
    expect(responseFormatFor("gpt-transcribe")).toBe("json");
    expect(responseFormatFor("gpt-4o-transcribe")).toBe("json");
    expect(responseFormatFor("gpt-4o-mini-transcribe")).toBe("json");
    expect(responseFormatFor("gpt-4o-transcribe-diarize")).toBe("diarized_json");
    expect(responseFormatFor("whisper-1")).toBe("verbose_json");
  });

  it("asks an unknown model for plain json, which every one of them takes", () => {
    expect(responseFormatFor("some-future-transcriber")).toBe("json");
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
      transcriptMarkdown(
        [
          { start: 0, end: 3.2, text: "morning" },
          { start: 63.5, end: 70, speaker: "B", text: "morning yourself" },
        ],
        "unused",
      ),
    ).toBe("[00:00] morning\n[01:03] B: morning yourself");
  });

  it("degrades to the plain text when the model returned no timings", () => {
    expect(transcriptMarkdown([], "just the words then")).toBe("just the words then");
  });
});
