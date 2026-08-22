import type { TCapturedBlob } from "@ragbag/client-runtime";
import { MAX_ATTACHMENTS, MAX_BLOB_BYTES, mutators } from "@ragbag/contracts";
import { faceForMime, newId, type TAttachmentFace } from "@ragbag/shared";
import { MenuView, type MenuAction } from "@react-native-menu/menu";
import { useZero } from "@rocicorp/zero/react";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { Image as ExpoImage } from "expo-image";
import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable } from "uniwind";
import { FACE_ICON, Icon } from "@/components/icon";
import { Text } from "@/components/text";
import { AudioRecorder, type TRecording } from "@/features/composer/audio-recorder";
import { useBlobQueue, useBlobUploadState } from "@/lib/blobs/queue";
import { formatBytes } from "@/lib/format";
import { toast } from "@/lib/toast";

// The message box. One send is one message: free text plus up to ten ordered
// attachments, exactly like a chat composer. There is no type picker and no
// kind guessing, because a message has no kind: a bare URL is just text that
// will produce a link entity, and that entity is what draws the preview card.
//
// Attachments behave like a chat composer's: a fixed square tile with its
// image preview appears the instant a file is picked; hashing, local
// persistence and the upload all happen behind it, each stage visible ON the
// tile. Nothing here waits silently: every async stage has a deadline, and a
// failure is a state on the tile rather than a mystery. That machinery exists
// because uploads once died silently in production.
//
// Two things the web composer has to do that this one does not, and one it
// cannot. There is no drag and drop and no window paste here: a phone has a
// share sheet instead, which is a different feature and not this file's. What
// there is instead is three real sources rather than one file input, so the
// attach button opens a native menu: the photo library, the camera, and files.
//
// It floats: a rounded bar inset from three edges with the archive running
// under it, rather than a strip walled off from the list by a hairline. That
// costs one thing and buys one thing. The cost is that the list no longer knows
// where its own bottom is, so this measures itself and hands the number up
// (`onHeight`) for the list to pad by. What it buys is that the bar can be
// glass and mean it: a material that refracts what is behind it is a lie when
// what is behind it is a wall.

const PLACEHOLDER = "Send anything: a thought, a link, a file…";

/** How long the local hash and persist may take before the tile goes red. */
const CAPTURE_TIMEOUT_MS = 12_000;

/** The tile's edge, fixed for every attachment in every state. */
const TILE = 112;

/**
 * Whether the system has a glass material to give us.
 *
 * Asked once, and behind a guard. It is a runtime question rather than a
 * platform one (iOS 26 has Liquid Glass, iOS 18 does not, Android answers no
 * without touching anything native), and it reaches for a native module to ask,
 * which a JS bundle loaded into an older binary than it was built against will
 * not find.
 */
const LIQUID_GLASS = (() => {
  try {
    return isLiquidGlassAvailable();
  } catch {
    return false;
  }
})();

type TDraftAttachment = {
  /** Chip identity from the moment of pick, before any blobId exists. */
  localId: string;
  file: File;
  name: string;
  size: number;
  mime: string;
  face: TAttachmentFace;
  /** A local URI to preview an image from, available before any upload. */
  previewUri: string | null;
  /** Measured on this device, so the bubble has its geometry before the send. */
  width?: number;
  height?: number;
  /** Recordings only, measured here so no device decodes audio to draw one. */
  durationMs?: number;
  waveform?: number[];
  /** The local stage: hashing and persisting ("reading") until a blobId exists. */
  status: "reading" | "ready" | "error";
  error?: string;
  /** False for validation failures (too large, empty); retrying cannot help. */
  retryable?: boolean;
  captured?: TCapturedBlob;
};

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

export function Composer({
  canAttach,
  onHeight,
}: {
  canAttach: boolean;
  /** How much of the list this bar is standing on, once it has been laid out. */
  onHeight: (height: number) => void;
}) {
  const zero = useZero();
  const queue = useBlobQueue();
  const insets = useSafeAreaInsets();
  const placeholderInk = useCSSVariable("--color-muted-foreground") as string;
  const ink = useCSSVariable("--color-foreground") as string;
  const [draft, setDraft] = useState("");
  // Attachments also live in a ref so async completions (a capture resolving
  // after its tile was removed, a dedupe check) can read the current list
  // without smuggling side effects into React state updaters.
  const [attachments, setAttachmentsState] = useState<TDraftAttachment[]>([]);
  const attachmentsRef = useRef<TDraftAttachment[]>([]);
  const setAttachments = useCallback((update: (prev: TDraftAttachment[]) => TDraftAttachment[]) => {
    attachmentsRef.current = update(attachmentsRef.current);
    setAttachmentsState(attachmentsRef.current);
  }, []);

  /** Hash and persist one picked file, then settle its tile. */
  const captureOne = useCallback(
    (localId: string, file: File, name: string) => {
      void withTimeout(
        queue.capture(file, name),
        CAPTURE_TIMEOUT_MS,
        "Timed out saving the file on this device",
      )
        .then((captured) => {
          const current = attachmentsRef.current;
          const me = current.find((a) => a.localId === localId);
          if (!me) {
            // Tile removed while reading: do not leave an orphan upload.
            if (!captured.reused) void queue.cancel(captured.blobId);
            return;
          }
          const dupe = current.find(
            (a) => a.localId !== localId && a.captured?.blobId === captured.blobId,
          );
          if (dupe) {
            toast.info(`${me.name} is already attached`);
            setAttachments((prev) => prev.filter((a) => a.localId !== localId));
            return;
          }
          setAttachments((prev) =>
            prev.map((a) => (a.localId === localId ? { ...a, status: "ready", captured } : a)),
          );
        })
        .catch((err: unknown) => {
          setAttachments((prev) =>
            prev.map((a) =>
              a.localId === localId
                ? {
                    ...a,
                    status: "error",
                    error: err instanceof Error ? err.message : "Couldn't read this file",
                    retryable: true,
                  }
                : a,
            ),
          );
        });
    },
    [queue, setAttachments],
  );

  const addFiles = useCallback(
    (picked: readonly TPickedFile[]) => {
      // Never a silent truncation (plan §8.5): picking fifteen photos attaches
      // the first ten and says what happened to the other five.
      const room = MAX_ATTACHMENTS - attachmentsRef.current.length;
      if (room <= 0) {
        toast.error(`${MAX_ATTACHMENTS} files max`, {
          description: "Send this message first, then attach the rest.",
        });
        return;
      }
      const accepted = picked.slice(0, room);
      if (picked.length > accepted.length) {
        const dropped = picked.length - accepted.length;
        toast.warning(`${MAX_ATTACHMENTS} files max`, {
          description: `${dropped} file${dropped === 1 ? " wasn't" : "s weren't"} added.`,
        });
      }

      for (const item of accepted) {
        const localId = newId();
        const face = faceForMime(item.mime);
        const base: TDraftAttachment = {
          localId,
          file: item.file,
          name: item.name,
          size: item.size,
          mime: item.mime,
          face,
          // The preview exists before any async work: the whole point. It is
          // the file's own URI, which is already on disk.
          previewUri: face === "image" ? item.file.uri : null,
          ...(item.width ? { width: item.width } : {}),
          ...(item.height ? { height: item.height } : {}),
          ...(item.durationMs ? { durationMs: item.durationMs } : {}),
          ...(item.waveform ? { waveform: item.waveform } : {}),
          status: "reading",
        };

        // Hopeless files fail on the tile immediately, not minutes later.
        if (item.size === 0) {
          setAttachments((prev) => [
            ...prev,
            { ...base, status: "error", error: "This file is empty", retryable: false },
          ]);
          continue;
        }
        if (item.size > MAX_BLOB_BYTES) {
          setAttachments((prev) => [
            ...prev,
            {
              ...base,
              status: "error",
              error: `Larger than the ${formatBytes(MAX_BLOB_BYTES)} limit`,
              retryable: false,
            },
          ]);
          continue;
        }

        setAttachments((prev) => [...prev, base]);
        captureOne(localId, item.file, item.name);

        // Dimensions are a column (plan §8.3), and the capturing device is the
        // first place that can know them, so the bubble is laid out correctly
        // here before the server has seen the bytes. The picker usually says;
        // a file picked from Files does not, so it is measured.
        if (face === "image" && !item.width) {
          void ExpoImage.loadAsync({ uri: item.file.uri })
            .then((ref) => {
              if (!ref.width || !ref.height) return;
              setAttachments((prev) =>
                prev.map((a) =>
                  a.localId === localId ? { ...a, width: ref.width, height: ref.height } : a,
                ),
              );
            })
            .catch(() => {
              // Undecodable here (a HEIC variant, a broken file): the
              // derivatives pass fills the dimensions in server-side.
            });
        }
      }
    },
    [captureOne, setAttachments],
  );

  const addRecording = useCallback(
    (recording: TRecording) => {
      addFiles([
        {
          file: recording.file,
          name: `Voice note ${new Date().toLocaleTimeString()}.m4a`,
          size: recording.file.size,
          mime: recording.file.type || "audio/m4a",
          durationMs: recording.durationMs,
          waveform: recording.waveform,
        },
      ]);
    },
    [addFiles],
  );

  const removeAttachment = (localId: string) => {
    const gone = attachmentsRef.current.find((a) => a.localId === localId);
    setAttachments((prev) => prev.filter((a) => a.localId !== localId));
    if (!gone) return;
    // A fresh capture with no message yet is ours to abort; a reused blobId
    // may belong to an already-sent message, so its upload must keep running.
    if (gone.captured && !gone.captured.reused) void queue.cancel(gone.captured.blobId);
  };

  const hasContent = draft.trim().length > 0 || attachments.length > 0;
  const reading = attachments.some((a) => a.status === "reading");
  const failed = attachments.some((a) => a.status === "error");
  const canSend = hasContent && !reading && !failed;
  const full = attachments.length >= MAX_ATTACHMENTS;

  const send = () => {
    const text = draft.trim();
    if (!canSend) return;

    // One message, one mutation: the attachments go with the text rather than
    // the text riding on the first of N separate items.
    const messageId = newId();
    const parts = attachments.map((a) => ({
      id: newId(),
      blobId: a.captured!.blobId,
      filename: a.name,
      mime: a.mime,
      size: a.size,
      width: a.width,
      height: a.height,
      durationMs: a.durationMs,
      waveform: a.waveform,
    }));

    void zero
      .mutate(
        mutators.message.create({ id: messageId, text: text || undefined, attachments: parts }),
      )
      .server.then((settled) => {
        if (settled.type === "error") toast.error("The server rejected a message");
      });

    for (const part of parts) {
      void queue.linkAttachment(part.blobId, messageId, part.id);
    }

    // No media-cache seeding, unlike the web. The capturing device's own bytes
    // are already in the blob queue's store, and expo-image will cache the
    // derivative under its URL the first time it is asked for. There is no
    // equivalent of the web's problem, where a Cache Storage entry has to be
    // written under the exact key a service worker will later read.

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAttachments(() => []);
    setDraft("");
  };

  const measure = (event: LayoutChangeEvent) => onHeight(event.nativeEvent.layout.height);

  return (
    // The composer rides the keyboard rather than being pushed by a padded
    // scroll view: KeyboardStickyView follows the frame natively, so it tracks
    // the keyboard's own curve instead of jumping after it has settled.
    //
    // Absolute, so the archive runs under it. The list is told how much of its
    // own bottom that costs rather than guessing (`onHeight`), and the bar is
    // measured on its outer box so the number includes the inset it floats on.
    // `box-none` on both boxes, or the bar's margins become an invisible strip
    // that eats every tap meant for the message behind them.
    <KeyboardStickyView
      offset={{ closed: 0, opened: 0 }}
      style={styles.dock}
      pointerEvents="box-none"
    >
      <View
        onLayout={measure}
        className="px-3 pt-2"
        style={{ paddingBottom: insets.bottom + 8 }}
        pointerEvents="box-none"
      >
        <Glass>
          {attachments.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
              className="grow-0"
              contentContainerClassName="gap-2 p-2"
            >
              {attachments.map((a) => (
                <AttachmentTile
                  key={a.localId}
                  attachment={a}
                  onRemove={() => removeAttachment(a.localId)}
                  onRetry={() => {
                    setAttachments((prev) =>
                      prev.map((x) =>
                        x.localId === a.localId ? { ...x, status: "reading", error: undefined } : x,
                      ),
                    );
                    captureOne(a.localId, a.file, a.name);
                  }}
                />
              ))}
            </ScrollView>
          ) : null}

          <TextInput
            multiline
            value={draft}
            onChangeText={setDraft}
            placeholder={PLACEHOLDER}
            placeholderTextColor={placeholderInk}
            // 16px minimum, always: anything smaller and iOS Safari-style zoom
            // behaviour on focus applies to the whole screen.
            className="max-h-40 px-4 pb-1 pt-3 text-base leading-relaxed"
            style={{ color: ink }}
            // Never autofocus: opening the app should show the archive, not the
            // keyboard over it.
            autoFocus={false}
            // Enter inserts a newline and the send button sends, which is what
            // every phone chat does: there is no shift on a soft keyboard.
            submitBehavior="newline"
            accessibilityLabel="Message"
          />

          <View className="flex-row items-center justify-between gap-2 p-2">
            <View className="flex-row items-center gap-1.5">
              <AttachButton disabled={!canAttach || full} onPicked={addFiles} full={full} />
              {/* The limit, said out loud, from the first file on. A cap nobody
                  can see is a cap that surprises you at ten. */}
              {attachments.length > 0 ? (
                <Text
                  className={`font-mono text-xs ${
                    full ? "text-warning-foreground" : "text-muted-foreground"
                  }`}
                >
                  {attachments.length}/{MAX_ATTACHMENTS}
                </Text>
              ) : null}
            </View>

            {/* The mic is the right-hand control while there is nothing to send,
                and send takes over the moment there is. */}
            {hasContent ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  failed
                    ? "Remove or retry the failed attachment first"
                    : reading
                      ? "Still reading an attachment"
                      : "Send"
                }
                accessibilityState={{ disabled: !canSend }}
                disabled={!canSend}
                onPress={send}
                className={`size-11 items-center justify-center rounded-full bg-primary active:bg-primary-hover ${
                  canSend ? "" : "opacity-50"
                }`}
              >
                <Icon name="send" size={20} />
              </Pressable>
            ) : (
              <AudioRecorder onRecorded={addRecording} />
            )}
          </View>
        </Glass>
      </View>
    </KeyboardStickyView>
  );
}

/**
 * The bar's material.
 *
 * The system's own glass where the system has one, which since iOS 26 is a real
 * Liquid Glass layer: it refracts and blurs the archive scrolling underneath
 * rather than approximating it, and it re-tints itself against whatever passes
 * under it, which nothing drawn in this app could do.
 *
 * Not `isInteractive`: that is the glass that lifts and brightens under a
 * finger, which is right for a button and wrong for the box one sits in.
 *
 * The fallback is opaque on purpose rather than a translucent fill pretending
 * to be glass: a flat wash of card colour at 80% over a photograph is not a
 * material, it is a photograph you cannot read text on. An opaque card with a
 * border is honest, and it is what the rest of the app is made of.
 */
function Glass({ children }: { children: ReactNode }) {
  if (LIQUID_GLASS) {
    return (
      <GlassView glassEffectStyle="regular" style={styles.bar}>
        {children}
      </GlassView>
    );
  }
  return (
    <View className="overflow-hidden rounded-3xl border border-border bg-card">{children}</View>
  );
}

const styles = StyleSheet.create({
  dock: { position: "absolute", left: 0, right: 0, bottom: 0 },
  // The radius lives here rather than in a class because GlassView shapes its
  // native layer from the style it is given, and a rounded box with a square
  // glass layer inside it is a square bar with rounded corners drawn on it.
  bar: { borderRadius: 24, overflow: "hidden" },
});

type TPickedFile = {
  file: File;
  name: string;
  size: number;
  mime: string;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: number[];
};

/**
 * Attach, which on a phone is three questions rather than one.
 *
 * A browser has one file input and the OS decides what it offers. Here the
 * library, the camera and the file system are three different pickers with
 * three different permissions, so the button opens a native menu and the
 * choice is made before anything is asked for. That also means the camera
 * permission is only ever requested by someone who tapped "Take photo".
 */
function AttachButton({
  disabled,
  full,
  onPicked,
}: {
  disabled: boolean;
  full: boolean;
  onPicked: (files: readonly TPickedFile[]) => void;
}) {
  const actions: MenuAction[] = [
    { id: "library", title: "Photo library", image: "photo.on.rectangle" },
    { id: "camera", title: "Take photo", image: "camera" },
    { id: "files", title: "Files", image: "folder" },
  ];

  const run = async (id: string) => {
    if (id === "files") {
      const result = await File.pickFileAsync({ multipleFiles: true });
      if (result.canceled) return;
      onPicked(result.result.map(fromFile));
      return;
    }

    const picker =
      id === "camera"
        ? ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
        : ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images", "videos", "livePhotos"],
            allowsMultipleSelection: true,
            selectionLimit: MAX_ATTACHMENTS,
            quality: 1,
          });
    const result = await picker;
    if (result.canceled) return;
    onPicked(result.assets.map(fromAsset));
  };

  return (
    <MenuView
      title="Attach"
      actions={actions}
      onPressAction={({ nativeEvent }) => void run(nativeEvent.event)}
      shouldOpenOnLongPress={false}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          disabled
            ? full
              ? `${MAX_ATTACHMENTS} files max in one message`
              : "Blob storage is not configured on the server"
            : "Attach files"
        }
        accessibilityState={{ disabled }}
        disabled={disabled}
        className={`size-11 items-center justify-center rounded-full border border-border bg-card active:bg-background-hover ${
          disabled ? "opacity-50" : ""
        }`}
      >
        <Icon name="plus" size={20} />
      </Pressable>
    </MenuView>
  );
}

function fromAsset(asset: ImagePicker.ImagePickerAsset): TPickedFile {
  const file = new File(asset.uri);
  return {
    file,
    name: asset.fileName ?? file.name,
    size: asset.fileSize ?? file.size,
    mime: asset.mimeType ?? file.type ?? "application/octet-stream",
    ...(asset.width ? { width: asset.width } : {}),
    ...(asset.height ? { height: asset.height } : {}),
    ...(asset.duration ? { durationMs: asset.duration } : {}),
  };
}

function fromFile(file: File): TPickedFile {
  return {
    file,
    name: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream",
  };
}

/**
 * One attachment tile: the picture, or a file face, with the live stage of
 * this file painted over it.
 *
 * Nothing inside a tile may size it. On the web that rule exists because
 * progress used to be a caption that re-measured the chip on every progress
 * event and walked the composer sideways a dozen times per upload; here the
 * tiles sit in a horizontal scroller, so a tile that grew would slide every
 * tile after it under the thumb about to tap one. State shows as a mark on a
 * veil over a square that never moves.
 */
function AttachmentTile({
  attachment: a,
  onRemove,
  onRetry,
}: {
  attachment: TDraftAttachment;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const queue = useBlobQueue();
  const upload = useBlobUploadState(a.captured?.blobId ?? null);

  const localFailure = a.status === "error";
  const uploadFailure = upload?.stage === "waiting" && upload.lastError !== null;
  const failedReason = localFailure ? a.error : uploadFailure ? upload.lastError : null;
  const retry = localFailure
    ? a.retryable
      ? onRetry
      : null
    : uploadFailure
      ? () => void queue.retryBlob(a.captured!.blobId)
      : null;

  const percent =
    upload?.stage === "inflight" && upload.progress !== null
      ? Math.round(upload.progress * 100)
      : null;
  const working = a.status === "reading" || (upload !== null && upload.stage !== "done");

  return (
    <View style={{ width: TILE, height: TILE }} className="shrink-0">
      <View
        className={`size-full overflow-hidden rounded-lg border bg-muted ${
          failedReason ? "border-destructive" : "border-border"
        }`}
      >
        {a.previewUri && !failedReason ? (
          <ExpoImage
            source={{ uri: a.previewUri }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            cachePolicy="memory"
          />
        ) : (
          <View className="flex-1 items-center justify-center gap-1 p-2">
            <Icon name={FACE_ICON[a.face]} size={24} />
            <Text className="text-center text-[11px] text-muted-foreground" numberOfLines={2}>
              {a.name}
            </Text>
          </View>
        )}

        {/* What this file is doing is painted *over* it, not instead of it. An
            opaque fill would make every picked photo a blank square with a
            spinner on it for as long as the upload took: the one stretch of
            time you most want to see which picture you picked. The mark that
            says what is happening sits on an opaque chip over the veil,
            because no ink in this palette reads over content it cannot
            predict. */}
        {failedReason || working ? (
          <Pressable
            accessibilityRole={retry ? "button" : "text"}
            accessibilityLabel={
              failedReason
                ? `${a.name}: ${failedReason}${retry ? ". Tap to retry." : ""}`
                : percent !== null
                  ? `Uploading ${percent}%`
                  : "Reading"
            }
            disabled={!retry}
            onPress={retry ?? undefined}
            className={`absolute inset-0 items-center justify-center ${
              failedReason ? "bg-destructive-soft/veil" : "bg-card/veil"
            }`}
          >
            <View
              className={`size-10 items-center justify-center rounded-full border bg-card ${
                failedReason ? "border-destructive" : "border-border"
              }`}
            >
              {failedReason ? (
                <Icon name={retry ? "retry" : "alert"} size={20} />
              ) : percent !== null ? (
                <Text className="font-mono text-[11px] font-medium">{percent}%</Text>
              ) : (
                <Icon name="spinner" size={20} />
              )}
            </View>
          </Pressable>
        ) : null}
      </View>

      {/* Hangs off the corner, outside the tile's own clip. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${a.name}`}
        hitSlop={10}
        onPress={onRemove}
        className="absolute -right-1.5 -top-1.5 size-6 items-center justify-center rounded-full border border-border bg-card active:bg-background-hover"
      >
        <Icon name="x" size={12} />
      </Pressable>
    </View>
  );
}
