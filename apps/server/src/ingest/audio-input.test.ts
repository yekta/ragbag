import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { ffmpegBinary, prepareAudio, sniffAudio, withExtension } from "./audio-input.js";

// The transcription endpoint reads the *name* of the upload, not the bytes,
// so what these assert is the difference between a transcript and a 400.

/** Just enough of a container for the sniffer, which only reads the header. */
function header(...parts: (string | number[])[]): Uint8Array {
  const bytes: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") for (const c of part) bytes.push(c.charCodeAt(0));
    else bytes.push(...part);
  }
  return new Uint8Array([...bytes, ...Array.from({ length: 64 }, () => 0)]);
}

describe("sniffAudio", () => {
  it("names the containers the endpoint takes by the extension it wants", () => {
    expect(sniffAudio(header("OggS")).ext).toBe("ogg");
    expect(sniffAudio(header("fLaC")).ext).toBe("flac");
    expect(sniffAudio(header("RIFF", [0, 0, 0, 0], "WAVE")).ext).toBe("wav");
    expect(sniffAudio(header("ID3")).ext).toBe("mp3");
    expect(sniffAudio(header([0xff, 0xfb])).ext).toBe("mp3");
    expect(sniffAudio(header([0x1a, 0x45, 0xdf, 0xa3], "Bwebm")).ext).toBe("webm");
    expect(sniffAudio(header([0, 0, 0, 0x20], "ftyp", "M4A ")).ext).toBe("m4a");
  });

  it("leaves the ones it does not take with no extension to be named", () => {
    // Every one of these is a file someone really does end up with: a phone
    // recorder, a Mac, a Windows machine, a video muxer.
    expect(sniffAudio(header("FORM", [0, 0, 0, 0], "AIFF")).ext).toBeNull();
    expect(sniffAudio(header("#!AMR")).ext).toBeNull();
    expect(sniffAudio(header([0x30, 0x26, 0xb2, 0x75])).ext).toBeNull();
    expect(sniffAudio(header("caff")).ext).toBeNull();
    expect(sniffAudio(header([0, 0, 0, 0x20], "ftyp", "3gp4")).ext).toBeNull();
    expect(sniffAudio(header([0x1a, 0x45, 0xdf, 0xa3], "Bmatroska")).ext).toBeNull();
    // ADTS AAC shares MP3's sync word and differs only in the layer bits.
    expect(sniffAudio(header([0xff, 0xf1])).ext).toBeNull();
    expect(sniffAudio(header("nothing audio about it")).ext).toBeNull();
  });
});

describe("withExtension", () => {
  it("renames to what the bytes actually are", () => {
    // The WhatsApp case: an ordinary Ogg stream, named for its codec, which
    // the endpoint refuses as "Unsupported file format opus".
    expect(withExtension("voice-note.opus", "ogg")).toBe("voice-note.ogg");
    expect(withExtension("recording.webm", "webm")).toBe("recording.webm");
    expect(withExtension("meeting 2026.01.03.m4a", "m4a")).toBe("meeting 2026.01.03.m4a");
    expect(withExtension("voicememo", "ogg")).toBe("voicememo.ogg");
    expect(withExtension("", "ogg")).toBe("recording.ogg");
  });
});

describe("prepareAudio", () => {
  it("sends a supported container as it is, under a name that matches it", async () => {
    const bytes = header("OggS");
    const prepared = await prepareAudio({
      bytes,
      filename: "voice-note.opus",
      mime: "audio/opus",
    });
    expect(prepared).toMatchObject({ filename: "voice-note.ogg", mime: "audio/ogg" });
    expect(prepared.bytes).toBe(bytes);
    expect(prepared.convertedFrom).toBeUndefined();
  });

  it("converts one the endpoint cannot read into Ogg it can", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ragbag-audio-test-"));
    try {
      const source = join(dir, "tone.aiff");
      const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"]
        .concat(["-f", "lavfi", "-i", "sine=frequency=440:duration=1"])
        .concat(["-c:a", "pcm_s16be", source]);
      await promisify(execFile)(ffmpegBinary()!, args);
      const prepared = await prepareAudio({
        bytes: await readFile(source),
        filename: "tone.aiff",
        mime: "audio/aiff",
      });
      expect(prepared).toMatchObject({
        filename: "tone.ogg",
        mime: "audio/ogg",
        convertedFrom: "aiff",
      });
      expect(Buffer.from(prepared.bytes).toString("latin1", 0, 4)).toBe("OggS");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
