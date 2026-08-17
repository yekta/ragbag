import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
  formatElapsed,
  recordingSupported,
  startRecording,
  type RecorderHandle,
  type Recording,
} from "@/lib/recorder";

// The composer's mic (plan §8.5): tap to start, a live elapsed timer, stop,
// and what comes out is an ordinary audio attachment, identical downstream to
// an `.m4a` someone drags in.
//
// Mic permission denial gets a real state rather than a dead button: the one
// thing a recorder must never do is look like it is working when it is not.

export function AudioRecorder({ onRecorded }: { onRecorded: (recording: Recording) => void }) {
  const [handle, setHandle] = useState<RecorderHandle | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [denied, setDenied] = useState(false);
  const handleRef = useRef<RecorderHandle | null>(null);
  handleRef.current = handle;

  // The timer polls the recorder rather than counting its own ticks: a tab
  // that was backgrounded comes back with the real elapsed time, not with
  // however many intervals the browser felt like delivering.
  useEffect(() => {
    if (!handle) return;
    const timer = setInterval(() => setElapsed(handle.elapsed()), 200);
    return () => clearInterval(timer);
  }, [handle]);

  // A recording left running when the composer unmounts would hold the mic
  // (and its indicator light) for the rest of the session.
  useEffect(() => () => handleRef.current?.cancel(), []);

  if (!recordingSupported()) return null;

  const start = async () => {
    try {
      const started = await startRecording();
      setDenied(false);
      setElapsed(0);
      setHandle(started);
    } catch {
      // Denied, or no microphone at all. Both are states, not errors to
      // swallow: the button says what happened and stays clickable, because
      // permission can be granted in the browser's own UI and tried again.
      setDenied(true);
      toast.error("No access to the microphone", {
        description: "Allow it for this site in your browser, then tap the mic again.",
      });
    }
  };

  const stop = async () => {
    const current = handle;
    setHandle(null);
    const recording = await current?.stop();
    if (recording) onRecorded(recording);
  };

  const discard = () => {
    handle?.cancel();
    setHandle(null);
  };

  if (!handle) {
    return (
      <Button
        variant="outline"
        size="icon"
        className={`rounded-full ${denied ? "border-destructive text-destructive" : "text-muted-foreground"}`}
        title={denied ? "Microphone blocked; tap to try again" : "Record a voice note"}
        onClick={() => void start()}
      >
        <Icon name={denied ? "alert" : "mic"} className="size-5" />
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <Button
        variant="ghost"
        size="icon"
        className="rounded-full text-muted-foreground"
        title="Discard this recording"
        onClick={discard}
      >
        <Icon name="x" className="size-5" />
      </Button>
      <span className="flex items-center gap-1.5 text-sm tabular-nums text-destructive">
        <span className="size-2 animate-pulse rounded-full bg-destructive" />
        {formatElapsed(elapsed)}
      </span>
      <Button
        size="icon"
        className="rounded-full"
        title="Stop and attach"
        onClick={() => void stop()}
      >
        <Icon name="stop" className="size-4" filled />
      </Button>
    </span>
  );
}
