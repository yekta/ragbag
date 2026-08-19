import { toFile } from "openai";
import type { AudioSegment } from "@ragbag/shared";
import { env } from "../env.js";
import { prepareAudio } from "./audio-input.js";
import { openai } from "./openai.js";
import { recordUsage } from "./usage.js";

// Phase A for audio (plan §5.2): one transcription call, turned into the same
// `content_md` shape everything else produces, plus `segments` for
// seek-to-match in the detail view.
//
// The recorder is what makes this the common case rather than an occasional
// `.m4a` someone drags in: the composer's mic produces an ordinary audio
// attachment, identical downstream (plan §8.5).

export type Transcription = {
  /** `[mm:ss] text`, one line per segment (plan §5.3). */
  contentMd: string;
  /** The same lines as data, so the player can seek to a search hit. */
  segments: AudioSegment[];
  /** 1-3 sentences, or the opening of the transcript when it is short. */
  summary: string;
};

/**
 * The response the configured model can actually return.
 *
 * There is no format all of them take, and asking for the wrong one is a hard
 * 400 that loses the whole call ("response_format 'verbose_json' is not
 * compatible with model 'gpt-transcribe'"), which is how every recording came
 * back as `transcription failed` instead of words. Timings only exist in two
 * of these: whisper's `verbose_json` and the diarizing model's
 * `diarized_json`, which also names the speakers. Everything else returns the
 * text alone, and the transcript degrades to a paragraph with no timecodes to
 * seek by.
 */
export function responseFormatFor(model: string): "verbose_json" | "diarized_json" | "json" {
  if (model.includes("diarize")) return "diarized_json";
  if (model.startsWith("whisper")) return "verbose_json";
  return "json";
}

export async function transcribeAudio(input: {
  bytes: Uint8Array;
  filename: string;
  mime: string;
  userId: string;
  messageId: string;
  attachmentId: string;
}): Promise<Transcription | null> {
  if (!openai) return null;

  // Named and, where it has to be, re-encoded as something the endpoint
  // accepts: it reads the extension, not the bytes (see audio-input.ts).
  const audio = await prepareAudio(input);
  const format = responseFormatFor(env.AI_TRANSCRIBE_MODEL);
  const res = await openai.audio.transcriptions.create({
    model: env.AI_TRANSCRIBE_MODEL,
    file: await toFile(Buffer.from(audio.bytes), audio.filename, { type: audio.mime }),
    response_format: format,
    // The diarizing model refuses the call outright without this once a
    // recording runs past 30 seconds ("chunking_strategy is required for
    // diarization models"), which is most of them. `auto` is its own
    // voice-activity split.
    ...(format === "diarized_json" ? { chunking_strategy: "auto" as const } : {}),
  });

  // One read for all three shapes: the two that carry timings agree on
  // start/end/text and differ only in `speaker`, and plain `json` is the text
  // on its own. Usage comes back as tokens from the models billed that way
  // and as seconds from the rest.
  const raw = res as unknown as {
    text?: string;
    duration?: number;
    segments?: { start: number; end: number; text: string; speaker?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number; seconds?: number };
  };
  const segments = namedSpeakers(
    (raw.segments ?? []).map((s) => ({
      start: s.start,
      end: s.end,
      ...(s.speaker ? { speaker: s.speaker } : {}),
      text: s.text.trim(),
    })),
  );
  const text = (raw.text ?? "").trim();
  if (!text && segments.length === 0) return null;

  await recordUsage({
    userId: input.userId,
    messageId: input.messageId,
    attachmentId: input.attachmentId,
    kind: "transcribe",
    model: env.AI_TRANSCRIBE_MODEL,
    inputTokens: raw.usage?.input_tokens ?? 0,
    outputTokens: raw.usage?.output_tokens ?? 0,
    seconds: raw.usage?.seconds ?? 0,
  });

  return {
    contentMd: transcriptMarkdown(segments, text),
    segments,
    summary: text.slice(0, 400),
  };
}

/**
 * Speaker labels, but only when there is more than one speaker to tell apart.
 * A diarized note of one person talking comes back "A" on every segment,
 * which is a column of noise down the transcript and down `content_md`.
 */
export function namedSpeakers(segments: AudioSegment[]): AudioSegment[] {
  const distinct = new Set(segments.map((s) => s.speaker).filter(Boolean));
  if (distinct.size > 1) return segments;
  return segments.map((s) => ({ start: s.start, end: s.end, text: s.text }));
}

/**
 * The audio shape of `content_md`: one timestamped line per segment, which is
 * readable by a human in the detail view and by the next model without a
 * parsing contract. A transcript with no timings degrades to the plain text,
 * because the format is a convention, not a schema.
 */
export function transcriptMarkdown(segments: readonly AudioSegment[], fallback: string): string {
  if (segments.length === 0) return fallback;
  return segments
    .map((s) => `[${stamp(s.start)}]${s.speaker ? ` ${s.speaker}:` : ""} ${s.text}`)
    .join("\n");
}

function stamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
