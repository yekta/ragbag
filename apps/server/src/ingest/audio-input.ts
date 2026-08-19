import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { log } from "@ragbag/shared";
import ffmpegStatic from "ffmpeg-static";
import { env } from "../env.js";

// Getting a recording into a shape the transcription endpoint will take.
//
// The endpoint decides what a file is by its *name*, not by its bytes: a
// WhatsApp voice note (`.opus`, an ordinary Ogg stream inside) comes back
// "Unsupported file format opus", and webm bytes named `.mp3` come back
// "Audio file might be corrupted or unsupported". Both are a hard 400 that
// fails the whole call. So the container is read out of the bytes here, the
// upload is named after what it actually is, and the formats the endpoint
// has no name for at all (AMR off an Android recorder, AIFF off a Mac, bare
// AAC, WMA) are converted before it ever sees them.

/** Extensions the endpoint accepts (its documented list). */
export const SUPPORTED_EXTENSIONS = [
  "flac",
  "m4a",
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "ogg",
  "wav",
  "webm",
] as const;

/** OpenAI's own upload ceiling for this endpoint, minus a margin. */
export const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

/** Anything the audio stage refuses before spending a call on it. */
export class AudioInputError extends Error {}
export class AudioTooLargeError extends AudioInputError {}
export class AudioUnsupportedError extends AudioInputError {}

export type SniffedAudio = {
  /** What the bytes are, in the words the error and the log line use. */
  label: string;
  /** The extension the endpoint knows this container by, null when it has none. */
  ext: string | null;
  mime: string | null;
};

export type PreparedAudio = {
  bytes: Uint8Array;
  filename: string;
  mime: string;
  /** The container it came from, set only when ffmpeg re-encoded it. */
  convertedFrom?: string;
};

/**
 * What the bytes actually are. Magic numbers rather than the browser's mime
 * or the name on the file, because those are exactly what is wrong in the
 * cases this exists for: a phone names an Ogg stream `.opus`, a share sheet
 * hands over `audio/mpeg` for whatever it happened to have.
 */
export function sniffAudio(bytes: Uint8Array): SniffedAudio {
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 512));
  const at = (offset: number, length: number) => head.toString("latin1", offset, offset + length);

  if (at(0, 4) === "OggS") return { label: "ogg", ext: "ogg", mime: "audio/ogg" };
  if (at(0, 4) === "fLaC") return { label: "flac", ext: "flac", mime: "audio/flac" };
  if (at(0, 4) === "RIFF" && at(8, 4) === "WAVE")
    return { label: "wav", ext: "wav", mime: "audio/wav" };
  if (at(0, 3) === "ID3") return { label: "mp3", ext: "mp3", mime: "audio/mpeg" };

  // EBML. webm and mkv are the same container with a different DocType, which
  // sits in the header a few bytes along, and only webm is on the list.
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return head.includes("webm", 0, "latin1")
      ? { label: "webm", ext: "webm", mime: "audio/webm" }
      : { label: "matroska", ext: null, mime: null };
  }

  // ISO base media. mp4 and its audio-only sibling are both taken; the brand
  // is what separates them from QuickTime and the 3GP phone containers, which
  // are not, whatever codec is inside.
  if (at(4, 4) === "ftyp") {
    const brand = at(8, 4);
    if (/^(3gp|3g2|qt)/.test(brand)) return { label: brand.trim(), ext: null, mime: null };
    return { label: "mp4", ext: "m4a", mime: "audio/mp4" };
  }

  // An MPEG audio frame. Bare ADTS AAC shares the sync word and is not on the
  // list, so the layer bits have to settle it: layer 0 is AAC, the rest MP3.
  if (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) {
    const layer = (head[1]! >> 1) & 0x03;
    return layer === 0
      ? { label: "aac", ext: null, mime: null }
      : { label: "mp3", ext: "mp3", mime: "audio/mpeg" };
  }

  if (at(0, 4) === "FORM" && at(8, 3) === "AIF") return { label: "aiff", ext: null, mime: null };
  if (at(0, 5) === "#!AMR") return { label: "amr", ext: null, mime: null };
  if (at(0, 4) === "caff") return { label: "caf", ext: null, mime: null };
  if (head[0] === 0x30 && head[1] === 0x26 && head[2] === 0xb2 && head[3] === 0x75) {
    return { label: "wma", ext: null, mime: null };
  }
  return { label: "unknown", ext: null, mime: null };
}

/** The upload, named and encoded as something the endpoint will accept. */
export async function prepareAudio(input: {
  bytes: Uint8Array;
  filename: string;
  mime: string;
}): Promise<PreparedAudio> {
  const sniffed = sniffAudio(input.bytes);
  const oversized = input.bytes.byteLength > MAX_AUDIO_BYTES;

  if (sniffed.ext && !oversized) {
    return {
      bytes: input.bytes,
      filename: withExtension(input.filename, sniffed.ext),
      mime: sniffed.mime ?? input.mime,
    };
  }

  const ffmpeg = ffmpegBinary();
  if (!ffmpeg) {
    if (oversized) throw tooLarge(input.bytes.byteLength, false);
    throw new AudioUnsupportedError(
      `this is ${article(sniffed.label)} file, which the transcription service does not read, ` +
        "and no ffmpeg was found to convert it (set FFMPEG_PATH). The file is kept and still plays.",
    );
  }

  // 16 kHz mono Opus: what a speech model listens to anyway, a tenth the size
  // of the original, and it doubles as the way a long recording gets under
  // the upload ceiling instead of being refused outright.
  const bytes = await convert(ffmpeg, input.bytes, sniffed);
  if (bytes.byteLength > MAX_AUDIO_BYTES) throw tooLarge(input.bytes.byteLength, true);
  log.debug("converted audio for transcription", {
    from: sniffed.label,
    fromBytes: input.bytes.byteLength,
    toBytes: bytes.byteLength,
  });
  return {
    bytes,
    filename: withExtension(input.filename, "ogg"),
    mime: "audio/ogg",
    convertedFrom: sniffed.label,
  };
}

function tooLarge(byteLength: number, converted: boolean): AudioTooLargeError {
  const mb = Math.round(byteLength / 1024 / 1024);
  return new AudioTooLargeError(
    `this recording is ${mb} MB; the transcription limit is 24 MB` +
      (converted ? ", which it is still over after being compressed" : "") +
      ". The file is kept and still plays.",
  );
}

/** The static binary that ships with the server, or a system one instead. */
export function ffmpegBinary(): string | null {
  return env.FFMPEG_PATH ?? ffmpegStatic ?? null;
}

async function convert(
  ffmpeg: string,
  bytes: Uint8Array,
  sniffed: SniffedAudio,
): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "ragbag-audio-"));
  const source = join(dir, `source${sniffed.ext ? `.${sniffed.ext}` : ""}`);
  const target = join(dir, "converted.ogg");
  try {
    await writeFile(source, bytes);
    await promisify(execFile)(
      ffmpeg,
      // `-nostdin` because this runs in a worker with no terminal: without it
      // ffmpeg can sit waiting on a prompt nobody will ever answer.
      ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", source]
        .concat(["-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k"])
        .concat([target]),
      { timeout: 5 * 60_000, maxBuffer: 1024 * 1024 },
    );
    return await readFile(target);
  } catch (err) {
    // ffmpeg's own words go to the log, not to the note on the row: what it
    // prints is a command line with a temp path in it, which tells the person
    // looking at their voice note nothing.
    log.warn("could not convert audio for transcription", {
      from: sniffed.label,
      err: String(err instanceof Error ? err.message : err).slice(0, 500),
    });
    throw new AudioUnsupportedError(
      `this ${sniffed.label} recording could not be converted into a format the ` +
        "transcription service reads. The file is kept and still plays.",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The name the upload goes under. Only the extension matters to the endpoint,
 * but the rest of the name is worth keeping: it is what shows up in an
 * OpenAI-side log next to the call.
 */
export function withExtension(filename: string, ext: string): string {
  const base = (filename.split("/").pop() ?? "").replace(/\.[A-Za-z0-9]{1,5}$/, "").trim();
  return `${base || "recording"}.${ext}`;
}

function article(label: string): string {
  return /^[aeiou]/i.test(label) ? `an ${label}` : `a ${label}`;
}
