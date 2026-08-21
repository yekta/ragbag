import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { AudioModule, RecordingPresets, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "@/components/icon";
import { Text } from "@/components/text";
import { formatDuration } from "@/components/attachment-album";
import { toast } from "@/lib/toast";

// A voice note, recorded on the device that is going to send it.
//
// The waveform and the duration are measured here and travel as columns on the
// attachment (plan §8.5), which is what lets every other device draw the
// recording without downloading it. The web app has to decode the blob in an
// AudioContext to get those; here the recorder reports its own level while it
// runs, so the peaks are sampled as they happen and cost nothing afterwards.

/** How many bars a waveform carries. Enough to have a shape, few enough to sync. */
const PEAKS = 48;

/** Sampling interval for the level meter, in ms. */
const SAMPLE_MS = 120;

export type TRecording = { file: File; durationMs: number; waveform: number[] };

export function AudioRecorder({ onRecorded }: { onRecorded: (recording: TRecording) => void }) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const state = useAudioRecorderState(recorder, SAMPLE_MS);
  const [busy, setBusy] = useState(false);
  const peaks = useRef<number[]>([]);
  const lastSample = useRef(0);

  // The meter reports dBFS, which is negative and logarithmic: -160 is silence
  // and 0 is clipping. The bars want 0..1, and the interesting part of speech
  // lives in the top 60 dB, so anything quieter than that is floored rather
  // than compressing the whole range into the bottom pixel.
  if (state.isRecording && state.metering !== undefined) {
    const now = Date.now();
    if (now - lastSample.current >= SAMPLE_MS && peaks.current.length < PEAKS) {
      lastSample.current = now;
      peaks.current.push(Math.max(0, Math.min(1, (state.metering + 60) / 60)));
    }
  }

  const start = async () => {
    setBusy(true);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        toast.error("Ragbag needs the microphone", {
          description: "Allow it in Settings to record a voice note.",
        });
        return;
      }
      // Recording and playback want different audio sessions, and a phone that
      // is told neither records at the wrong sample rate or through the wrong
      // input. iOS in particular routes to the earpiece afterwards unless this
      // is set back.
      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      peaks.current = [];
      lastSample.current = 0;
      await recorder.prepareToRecordAsync();
      recorder.record();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      toast.error("Couldn't start recording");
    } finally {
      setBusy(false);
    }
  };

  const stop = async (keep: boolean) => {
    setBusy(true);
    try {
      const durationMs = state.durationMillis;
      await recorder.stop();
      await AudioModule.setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!keep) {
        if (uri) new File(uri).delete();
        return;
      }
      if (!uri) {
        toast.error("The recording was lost before it could be saved");
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onRecorded({ file: new File(uri), durationMs, waveform: [...peaks.current] });
    } catch {
      toast.error("Couldn't save the recording");
    } finally {
      setBusy(false);
    }
  };

  if (!state.isRecording) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Record a voice note"
        disabled={busy}
        onPress={() => void start()}
        className="size-11 items-center justify-center rounded-full border border-border bg-card active:bg-background-hover"
      >
        <Icon name="mic" size={20} />
      </Pressable>
    );
  }

  // While recording, the one control becomes two: discard and keep. A single
  // tap-to-stop would have no way back from a recording started by accident,
  // and a voice note is the one attachment you cannot glance at to check.
  return (
    <View className="flex-row items-center gap-2">
      <Text className="font-mono text-xs text-destructive">
        {formatDuration(state.durationMillis)}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Discard recording"
        disabled={busy}
        onPress={() => void stop(false)}
        className="size-11 items-center justify-center rounded-full border border-border bg-card active:bg-background-hover"
      >
        <Icon name="trash" size={18} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop and attach recording"
        disabled={busy}
        onPress={() => void stop(true)}
        className="size-11 items-center justify-center rounded-full bg-destructive active:bg-destructive-hover"
      >
        <Icon name="stop" size={18} />
      </Pressable>
    </View>
  );
}
