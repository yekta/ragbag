import type { TAudioSegment } from "@ragbag/shared";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Pressable, ScrollView, View } from "react-native";
import { formatDuration } from "@/components/attachment-album";
import { Icon } from "@/components/icon";
import { Text } from "@/components/text";
import { mediaSource } from "@/lib/media";

// A voice note, played, with its transcript.
//
// The web app splits these across two subtrees (the player is in the message
// at the top of the panel, the transcript is down in the findings) and needs a
// context to introduce them to each other. Here they are one component,
// because this is the only surface that plays audio: a card in a scrolling
// timeline is not a transport, and the file's own page is where the transcript
// is anyway.
//
// The source is the same authenticated media URL every picture uses, so the
// bytes come through the same route with the same credential rather than
// through a second download path.

export function AudioTranscript({
  blobId,
  segments,
}: {
  blobId: string;
  segments: readonly TAudioSegment[];
}) {
  const player = useAudioPlayer(mediaSource(blobId, "original"));
  const status = useAudioPlayerStatus(player);
  const position = status.currentTime;

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-3 rounded-xl border border-border bg-panel p-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={status.playing ? "Pause" : "Play"}
          onPress={() => (status.playing ? player.pause() : player.play())}
          className="size-11 items-center justify-center rounded-full bg-primary active:bg-primary-hover"
        >
          <Icon name={status.playing ? "pause" : "play"} size={20} />
        </Pressable>
        <View className="flex-1 gap-1">
          {/* The bar is a reading, not a control: seeking happens by tapping a
              line of the transcript, which is a better target than a 4pt strip
              and says where you are going. */}
          <View className="h-1 overflow-hidden rounded-full bg-muted">
            <View
              className="h-full rounded-full bg-primary"
              style={{
                width: `${status.duration > 0 ? Math.min(100, (position / status.duration) * 100) : 0}%`,
              }}
            />
          </View>
          <Text className="font-mono text-[11px] text-muted-foreground">
            {formatDuration(position * 1000)} / {formatDuration(status.duration * 1000)}
          </Text>
        </View>
      </View>

      <View className="max-h-96 rounded-xl border border-border bg-panel p-3">
        <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
          {segments.map((segment, i) => {
            const active = position >= segment.start && position < segment.end;
            return (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityLabel={`Play from ${formatDuration(segment.start * 1000)}`}
                onPress={() => {
                  void player.seekTo(segment.start);
                  if (!status.playing) player.play();
                }}
                className={`-mx-1.5 rounded-md px-1.5 py-0.5 ${
                  active ? "bg-accent" : "active:bg-panel-hover"
                }`}
              >
                <Text className="text-[13px] leading-relaxed">
                  <Text className="font-mono text-[11px] text-muted-foreground">
                    {formatDuration(segment.start * 1000)}{" "}
                  </Text>
                  {segment.speaker ? (
                    <Text className="text-[13px] font-medium">{segment.speaker}: </Text>
                  ) : null}
                  {segment.text}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}
