import { useCallback, useEffect, useRef, useState } from "react";

// Voice capture for the composer, via the browser's own SpeechRecognition —
// no server round-trip, no API cost. Support is uneven (Chrome/Edge yes,
// Safari behind a prefix, Firefox no), so `supported` is reported and the UI
// falls back to hiding the mic rather than offering a dead button.

type RecognitionEvent = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

// SpeechRecognition is an EventTarget, so its events are subscribed to rather
// than assigned — but `result` isn't in the DOM event map, hence the cast.
type Recognition = EventTarget & {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
};

type RecognitionCtor = new () => Recognition;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type Dictation = {
  supported: boolean;
  listening: boolean;
  /** Start listening, appending onto whatever is already typed. */
  start: (currentText: string) => void;
  stop: () => void;
};

/**
 * @param onTranscript receives the full text (existing draft + speech) as it
 * is recognised, so the composer can render interim words live.
 */
export function useDictation(onTranscript: (text: string) => void): Dictation {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<Recognition | null>(null);
  const prefixRef = useRef("");
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  // Never leave the microphone open behind a closed composer.
  useEffect(() => stop, [stop]);

  const start = useCallback((currentText: string) => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    prefixRef.current = currentText.trim() ? `${currentText.trimEnd()} ` : "";

    recognition.addEventListener("result", (event) => {
      const { results } = event as Event & RecognitionEvent;
      let spoken = "";
      for (let i = 0; i < results.length; i++) {
        spoken += results[i]?.[0]?.transcript ?? "";
      }
      onTranscriptRef.current(prefixRef.current + spoken.trimStart());
    });
    // Either way the session is over: drop the handle and release the button.
    const finish = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognition.addEventListener("end", finish);
    recognition.addEventListener("error", finish);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, []);

  return { supported: getRecognitionCtor() !== null, listening, start, stop };
}
