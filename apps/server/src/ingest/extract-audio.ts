import { toFile } from "openai";
import type { TAudioSegment } from "@ragbag/shared";
import { env } from "../env.js";
import { prepareAudio } from "./audio-input.js";
import { PermanentError } from "./errors.js";
import {
  AI_MODEL_AUDIO_TRANSCRIPTION_RESPONSE_FORMAT,
  chunkingStrategyFor,
  type TTranscriptionResponseFormat,
} from "./models.js";
import { openai } from "./openai.js";
import { recordUsage } from "./usage.js";

// Phase A for audio (plan §5.2): one transcription call, turned into the same
// `content_md` shape everything else produces, plus `segments` for
// seek-to-match in the detail view.
//
// The recorder is what makes this the common case rather than an occasional
// `.m4a` someone drags in: the composer's mic produces an ordinary audio
// attachment, identical downstream (plan §8.5).

export type TTranscription = {
  /** `[mm:ss] text`, one line per segment (plan §5.3). */
  contentMd: string;
  /** The same lines as data, so the player can seek to a search hit. */
  segments: TAudioSegment[];
  /** 1-3 sentences, or the opening of the transcript when it is short. */
  summary: string;
};

export async function transcribeAudio(input: {
  bytes: Uint8Array;
  filename: string;
  mime: string;
  userId: string;
  messageId: string;
  attachmentId: string;
}): Promise<TTranscription | null> {
  if (!openai) return null;

  // Named and, where it has to be, re-encoded as something the endpoint
  // accepts: it reads the extension, not the bytes (see audio-input.ts).
  const audio = await prepareAudio(input);
  // Widened on purpose: the table only holds `json` today, and narrowing to
  // that literal would make the diarizing branch below a type error rather
  // than the dormant path it is.
  const format: TTranscriptionResponseFormat =
    AI_MODEL_AUDIO_TRANSCRIPTION_RESPONSE_FORMAT[env.AI_TRANSCRIBE_MODEL];
  const res = await openai.audio.transcriptions.create({
    model: env.AI_TRANSCRIBE_MODEL,
    file: await toFile(Buffer.from(audio.bytes), audio.filename, { type: audio.mime }),
    response_format: format,
    ...chunkingStrategyFor(format),
  });

  // One read for all three shapes: the two that carry timings agree on
  // start/end/text and differ only in `speaker`, and plain `json` is the text
  // on its own. `usage` is the SDK's own discriminated union: models billed
  // by the minute report `duration`, models billed by tokens report `tokens`.
  const raw = res as unknown as {
    text?: string;
    duration?: number;
    segments?: { start: number; end: number; text: string; speaker?: string }[];
    usage?:
      | { type: "duration"; seconds: number }
      | { type: "tokens"; input_tokens: number; output_tokens: number };
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

  // Every transcription model in the enum is priced per minute, so the
  // duration is the only thing that meters this call. Without it the row
  // would say $0.00 about audio that was really paid for, so say so instead.
  if (raw.usage?.type !== "duration") {
    throw new PermanentError(
      `OpenAI returned no audio duration for the transcribe call (${raw.usage?.type ?? "no usage"}), so it cannot be metered`,
    );
  }
  await recordUsage({
    userId: input.userId,
    messageId: input.messageId,
    attachmentId: input.attachmentId,
    kind: "transcribe",
    model: env.AI_TRANSCRIBE_MODEL,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    seconds: raw.usage.seconds,
  });

  return {
    contentMd: transcriptMarkdown({ segments, fallback: text }),
    segments,
    summary: text.slice(0, 400),
  };
}

/**
 * Speaker labels, but only when there is more than one speaker to tell apart.
 * A diarized note of one person talking comes back "A" on every segment,
 * which is a column of noise down the transcript and down `content_md`.
 */
export function namedSpeakers(segments: TAudioSegment[]): TAudioSegment[] {
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
export function transcriptMarkdown(input: {
  segments: readonly TAudioSegment[];
  fallback: string;
}): string {
  if (input.segments.length === 0) return input.fallback;
  return input.segments
    .map((s) => `[${stamp(s.start)}]${s.speaker ? ` ${s.speaker}:` : ""} ${s.text}`)
    .join("\n");
}

function stamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
