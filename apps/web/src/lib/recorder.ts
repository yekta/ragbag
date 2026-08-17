// The mic is a recorder now (plan §8.5), not browser dictation.
//
// v1 used the SpeechRecognition API to turn speech into text in the box.
// Mobile keyboards already do that better, and a recording is a better
// artifact anyway: it survives the transcription being wrong, and it
// transcribes server-side into the same searchable `content_md` every other
// attachment produces.
//
// Format differs by browser: Chromium and Firefox give `audio/webm;codecs=opus`,
// Safari gives `audio/mp4`. Whatever comes out is what gets stored; the mime
// is on the blob row and the transcription stage reads it there.

const CANDIDATE_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return CANDIDATE_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** How many peaks a waveform carries; enough to draw, small enough to sync. */
const WAVEFORM_BUCKETS = 64;

export type Recording = {
  file: File;
  durationMs: number;
  /** 0-1 peaks, computed here so no device ever decodes audio to draw a bubble. */
  waveform: number[];
};

export type RecorderHandle = {
  stop: () => Promise<Recording | null>;
  cancel: () => void;
  /** Elapsed ms, polled by the timer in the composer. */
  elapsed: () => number;
};

/**
 * Start recording. Rejects when the user denies the mic, which the composer
 * turns into a real state rather than a dead button.
 */
export async function startRecording(): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  let cancelled = false;

  recorder.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  });
  recorder.start(250);

  const release = () => {
    for (const track of stream.getTracks()) track.stop();
  };

  return {
    elapsed: () => Date.now() - startedAt,
    cancel: () => {
      cancelled = true;
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
    stop: () =>
      new Promise<Recording | null>((resolve) => {
        recorder.addEventListener("stop", () => {
          release();
          if (cancelled || chunks.length === 0) return resolve(null);
          const type = recorder.mimeType || mimeType || "audio/webm";
          const blob = new Blob(chunks, { type });
          // The extension has to match the container or the transcription
          // endpoint sniffs the wrong one.
          const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
          const file = new File([blob], `recording.${extension}`, { type });
          void analyze(blob, Date.now() - startedAt).then((measured) =>
            resolve({ file, ...measured }),
          );
        });
        if (recorder.state !== "inactive") recorder.stop();
        else release();
      }),
  };
}

/**
 * Duration and waveform peaks, measured on the capturing device (plan §8.5).
 *
 * Doing it here means the tile and the chat bubble have them before the server
 * sees the file, nothing gets decoded per render, and other devices draw the
 * waveform without downloading the audio at all. Falls back to the wall-clock
 * duration and a flat waveform when the browser cannot decode what it just
 * recorded, which happens on some Safari builds.
 */
export async function analyze(
  blob: Blob,
  wallClockMs: number,
): Promise<{ durationMs: number; waveform: number[] }> {
  const Ctor =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return { durationMs: wallClockMs, waveform: [] };
  const context = new Ctor();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    const samples = audio.getChannelData(0);
    const per = Math.max(1, Math.floor(samples.length / WAVEFORM_BUCKETS));
    const waveform: number[] = [];
    for (let i = 0; i < WAVEFORM_BUCKETS; i++) {
      let peak = 0;
      for (let j = i * per; j < (i + 1) * per && j < samples.length; j++) {
        const value = Math.abs(samples[j]!);
        if (value > peak) peak = value;
      }
      // Two decimals is all a 3px bar can show, and it keeps the synced array
      // to a few hundred bytes.
      waveform.push(Math.round(peak * 100) / 100);
    }
    return { durationMs: Math.round(audio.duration * 1000), waveform };
  } catch {
    return { durationMs: wallClockMs, waveform: [] };
  } finally {
    void context.close();
  }
}

/** mm:ss, the only format a voice note's length is ever shown in. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
