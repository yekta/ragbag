import { toFile } from "openai";
import type { AudioSegment } from "@ragbag/shared";
import { env } from "../env.js";
import { openai } from "./openai.js";
import { recordUsage } from "./usage.js";

// Phase A for audio (plan §5.2): one transcription call, turned into the same
// `content_md` shape everything else produces, plus `segments` for
// seek-to-match in the detail view.
//
// The recorder is what makes this the common case rather than an occasional
// `.m4a` someone drags in: the composer's mic produces an ordinary audio
// attachment, identical downstream (plan §8.5).

/** OpenAI's own upload ceiling for this endpoint, minus a margin. */
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

export type Transcription = {
  /** `[mm:ss] text`, one line per segment (plan §5.3). */
  contentMd: string;
  /** The same lines as data, so the player can seek to a search hit. */
  segments: AudioSegment[];
  /** 1-3 sentences, or the opening of the transcript when it is short. */
  summary: string;
};

export class AudioTooLargeError extends Error {}

export async function transcribeAudio(input: {
  bytes: Uint8Array;
  filename: string;
  mime: string;
  userId: string;
  messageId: string;
  attachmentId: string;
}): Promise<Transcription | null> {
  if (!openai) return null;
  if (input.bytes.byteLength > MAX_AUDIO_BYTES) {
    throw new AudioTooLargeError(
      `this recording is ${Math.round(input.bytes.byteLength / 1024 / 1024)} MB; the ` +
        "transcription limit is 24 MB. The file is kept and still plays.",
    );
  }

  // `verbose_json` is what carries the segment timings. The mime is whatever
  // the recording browser produced (webm/opus on Chromium and Firefox, mp4 on
  // Safari); the endpoint sniffs the container, so it rides on the filename
  // and content type rather than being converted here.
  const res = await openai.audio.transcriptions.create({
    model: env.AI_TRANSCRIBE_MODEL,
    file: await toFile(Buffer.from(input.bytes), input.filename, { type: input.mime }),
    response_format: "verbose_json",
  });

  const raw = res as unknown as {
    text?: string;
    duration?: number;
    segments?: { start: number; end: number; text: string }[];
  };
  const segments: AudioSegment[] = (raw.segments ?? []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
  }));
  const text = (raw.text ?? "").trim();
  if (!text && segments.length === 0) return null;

  await recordUsage({
    userId: input.userId,
    messageId: input.messageId,
    attachmentId: input.attachmentId,
    kind: "transcribe",
    model: env.AI_TRANSCRIBE_MODEL,
    // The transcription endpoints report usage in tokens when they report it
    // at all; a missing count meters the call at zero rather than guessing.
    inputTokens: 0,
    outputTokens: 0,
  });

  return {
    contentMd: transcriptMarkdown(segments, text),
    segments,
    summary: text.slice(0, 400),
  };
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
