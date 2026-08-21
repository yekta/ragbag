import { Pressable, View } from "react-native";
import { Icon } from "@/components/icon";
import { Text } from "@/components/text";
import { useBlobQueue, useBlobQueueState, useBlobUploadState } from "@/lib/blobs/queue";

/**
 * "This file hasn't reached the server yet", pinned over a freshly-sent
 * attachment.
 *
 * The bytes render locally either way, which is the local-first deal; this
 * badge is the difference between "uploading", "waiting" and "failing, here is
 * why". Those states used to be invisible until another device quietly could
 * not load the image.
 *
 * It is its own control inside a tile that is also a control, which on a touch
 * screen is a real hazard: a 20pt chip inside a 100pt tile is a tap most
 * thumbs miss in one direction or the other. So it is only pressable when
 * there is something to do about it, which is the failing state, and it takes
 * a hit slop rather than growing the chip.
 */
export function UploadBadge({
  blobId,
  side = "left",
}: {
  blobId: string | null;
  /** Which top corner to pin to: right for rows, left over pictures. */
  side?: "left" | "right";
}) {
  const queue = useBlobQueue();
  const { blocked } = useBlobQueueState();
  const upload = useBlobUploadState(blobId);
  if (!blobId || !upload || upload.stage === "done") return null;

  const failing = upload.stage === "waiting" && upload.lastError !== null && blocked !== "auth";
  const percent =
    upload.stage === "inflight" && upload.progress !== null
      ? Math.round(upload.progress * 100)
      : null;

  const label = failing
    ? `Upload failing: ${upload.lastError}. Tap to retry now.`
    : blocked === "auth"
      ? "Upload paused, sign in to resume"
      : percent !== null
        ? `Uploading ${percent}%`
        : "Waiting to upload";

  const icon = failing ? "alert" : blocked === "auth" ? "pause" : "spinner";

  return (
    <Pressable
      accessibilityRole={failing ? "button" : "text"}
      accessibilityLabel={label}
      disabled={!failing}
      hitSlop={10}
      onPress={() => {
        if (failing) void queue.retryBlob(blobId);
      }}
      className={`absolute top-1.5 flex-row items-center gap-1 rounded-full border px-1.5 py-0.5 ${
        side === "left" ? "left-1.5" : "right-1.5"
      } ${failing ? "border-destructive bg-panel active:bg-destructive-soft" : "border-border bg-panel"}`}
    >
      <Icon name={icon} size={12} />
      <View className={percent !== null ? "min-w-[3ch] items-end" : undefined}>
        <Text
          className={`font-mono text-[10px] font-medium ${
            failing ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {/* The mono makes every digit the same width; the minimum makes every
              *count* of digits the same width, which is the rest of the jitter.
              A progress event lands dozens of times per upload and two of those
              ticks cross a digit boundary, so without a floor the chip is a
              different size for 9% than for 10%. Three characters covers 0-99,
              where all the counting happens. */}
          {failing ? "upload failed" : percent !== null ? `${percent}%` : "uploading"}
        </Text>
      </View>
    </Pressable>
  );
}
