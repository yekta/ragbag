// Acceptance check for the audio stage against the live transcription
// endpoint: speech in, `content_md` out, through the same conversion step and
// the same request the ingest worker sends.
//
// This is the one stage whose contract lives entirely on OpenAI's side. Which
// response_format a model will answer in, and which containers it will even
// open, are in no type and no unit test, and getting either wrong is a 400
// that fails every recording in the archive at once rather than one of them.
//
// Needs OPENAI_API_KEY and the dev database (it writes the usage ledger):
//   pnpm --filter server exec tsx scripts/transcribe-proof.mts
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { newId } from "@ragbag/shared";
import { env } from "../src/env.js";
import { ffmpegBinary } from "../src/ingest/audio-input.js";
import { transcribeAudio } from "../src/ingest/extract-audio.js";
import { openai } from "../src/ingest/openai.js";

const SPOKEN = "The quick brown fox jumps over the lazy dog.";

function fail(msg: string): never {
  console.error(`FAIL ${msg}`);
  process.exit(1);
}

// Every assertion here is model-dependent, so with no key there is nothing to
// prove rather than something failing, which is how the other proofs behave.
if (!openai) {
  console.log("SKIP no OPENAI_API_KEY");
  process.exit(0);
}

const ffmpeg = ffmpegBinary();
if (!ffmpeg) fail("no ffmpeg binary, so unsupported audio cannot be converted");

const dir = await mkdtemp(join(tmpdir(), "ragbag-transcribe-proof-"));
try {
  // Speech rather than a tone, because the assertion worth making is that the
  // words come back, not that the call returned 200.
  const speech = await openai.audio.speech.create({
    model: "tts-1",
    voice: "alloy",
    input: SPOKEN,
    response_format: "mp3",
  });
  const source = join(dir, "spoken.mp3");
  await writeFile(source, Buffer.from(await speech.arrayBuffer()));

  const convert = async (name: string, ...args: string[]) => {
    const target = join(dir, name);
    await promisify(execFile)(
      ffmpeg,
      ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", source]
        .concat(args)
        .concat([target]),
    );
    return target;
  };

  const cases = [
    // What the composer's own recorder produces, on the browsers that produce
    // it: already a container the endpoint takes.
    { name: "recording.webm", path: await convert("recording.webm", "-c:a", "libopus") },
    // A voice note off a phone: an ordinary Ogg stream named for its codec,
    // which the endpoint refuses by name alone.
    { name: "voice-note.opus", path: await convert("voice-note.opus", "-c:a", "libopus") },
    // One it cannot read at all, so ffmpeg has to re-encode it first.
    { name: "memo.aiff", path: await convert("memo.aiff", "-c:a", "pcm_s16be") },
    { name: "spoken.mp3", path: source },
  ];

  for (const item of cases) {
    const heard = await transcribeAudio({
      bytes: await readFile(item.path),
      filename: item.name,
      mime: "application/octet-stream",
      userId: `proof-${newId()}`,
      messageId: newId(),
      attachmentId: newId(),
    });
    if (!heard) fail(`${item.name}: transcribed to nothing`);
    if (!/quick brown fox/i.test(heard.contentMd)) {
      fail(`${item.name}: transcript does not contain what was said: ${heard.contentMd}`);
    }
    console.log(
      `ok ${item.name.padEnd(18)} ${heard.segments.length} segments  ${JSON.stringify(
        heard.contentMd.slice(0, 60),
      )}`,
    );
  }

  console.log(`\nPASS ${cases.length} recordings transcribed with ${env.AI_TRANSCRIBE_MODEL}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
process.exit(0);
