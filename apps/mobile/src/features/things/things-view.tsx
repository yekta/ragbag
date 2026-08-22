import type {
  TAttachment,
  TEntityRow,
  TEntityRows,
  TMessage,
  TMessages,
} from "@ragbag/client-runtime/rows";
import { faceForMime } from "@ragbag/shared";
import { LegendList } from "@legendapp/list/react-native";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { EmptyScreen } from "@/components/empty-screen";
import { EntityCard } from "@/components/entities";
import { TimelineEntities } from "@/components/entities/shell";
import { FACE_ICON, Icon } from "@/components/icon";
import { MediaImage } from "@/components/media-image";
import { Text } from "@/components/text";
import { useEntityTypes } from "@/features/session/entity-types";
import { dayLabel, formatBytes } from "@/lib/format";
import {
  attachmentFaceOf,
  attachmentHref,
  entityHref,
  entityKindOf,
  useFilter,
} from "@/lib/routes";

// The other half of the sidebar (plan §8.2). Chat-shaped rows filter the chat;
// thing-shaped rows replace it with a grid (images) or a list (everything
// else), newest first, each row opening the thing it draws.
//
// Why not just filter the chat: filtering it to "messages containing an image"
// is strictly worse than showing the images. You lose density (one chat row
// per photo against a grid three or four across) and gain nothing, because the
// image *is* the content. Same for addresses: a list of places with map
// buttons is useful; a filtered chat where you hunt inside bubbles is not.

export function ThingsView({
  messages,
  entities,
  inset,
}: {
  messages: TMessages;
  entities: TEntityRows;
  /** What the floating composer covers at the bottom of every list here. */
  inset: number;
}) {
  const filter = useFilter();
  const face = attachmentFaceOf(filter.view);
  const kind = entityKindOf(filter.view, useEntityTypes());

  if (face) return <AttachmentThings messages={messages} face={face} inset={inset} />;
  if (kind) return <EntityThings entities={entities} kind={kind} inset={inset} />;
  return <EmptyScreen />;
}

type TFound = { attachment: TAttachment; message: TMessage };

/** Newest first, and "newest" is the message's time, not the file's position. */
function useAttachments(messages: TMessages, face: string): TFound[] {
  return useMemo(() => {
    const found: TFound[] = [];
    for (const message of messages) {
      for (const attachment of message.attachments) {
        // `images` is the picture face; `files` is everything that is not one,
        // which is what makes the two rows cover every attachment between them.
        const mine =
          face === "image"
            ? faceForMime(attachment.mime) === "image"
            : faceForMime(attachment.mime) !== "image";
        if (mine) found.push({ attachment, message });
      }
    }
    return found;
  }, [messages, face]);
}

/** Tiles across the grid. Three on a phone; the sidebar takes the rest. */
const GRID_COLUMNS = 3;

function AttachmentThings({
  messages,
  face,
  inset,
}: {
  messages: TMessages;
  face: string;
  inset: number;
}) {
  const found = useAttachments(messages, face);
  const router = useRouter();

  if (found.length === 0) return <EmptyScreen />;

  if (face === "image") {
    return (
      <LegendList
        data={found}
        numColumns={GRID_COLUMNS}
        keyExtractor={(item: TFound) => item.attachment.id}
        estimatedItemSize={128}
        contentContainerStyle={{ padding: 8, paddingBottom: inset + 8 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }: { item: TFound }) => (
          <View className="p-0.5" style={{ width: `${100 / GRID_COLUMNS}%` }}>
            <Pressable
              accessibilityRole="imagebutton"
              accessibilityLabel={item.attachment.generatedTitle ?? item.attachment.filename}
              onPress={() => router.push(attachmentHref(item.attachment.id))}
              // A photo covers its tile, so there is no fill under it to step
              // off: the press dims the picture instead.
              className="aspect-square overflow-hidden rounded-xl border border-border active:opacity-80"
            >
              <MediaImage attachment={item.attachment} variant="thumb" style={{ flex: 1 }} />
            </Pressable>
          </View>
        )}
      />
    );
  }

  return (
    <LegendList
      data={found}
      keyExtractor={(item: TFound) => item.attachment.id}
      estimatedItemSize={80}
      contentContainerStyle={{ gap: 6, padding: 12, paddingBottom: inset + 12 }}
      showsVerticalScrollIndicator={false}
      renderItem={({ item }: { item: TFound }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(attachmentHref(item.attachment.id))}
          className="flex-row items-center gap-3 rounded-2xl border border-border bg-background p-3.5 active:bg-background-hover"
        >
          <View className="size-10 shrink-0 items-center justify-center rounded-md bg-muted">
            <Icon name={FACE_ICON[faceForMime(item.attachment.mime)]} size={20} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="font-medium" numberOfLines={1}>
              {item.attachment.generatedTitle ?? item.attachment.filename}
            </Text>
            <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
              {/* Readings take the mono, the name it belongs to does not: a
                  filename is not a measurement, and mono would only make the
                  long ones truncate sooner. */}
              <Text className="font-mono text-[11px] text-muted-foreground">
                {formatBytes(item.attachment.size)}
              </Text>
              {` · ${item.attachment.filename}`}
            </Text>
          </View>
          <Text className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {dayLabel(item.message.createdAt)}
          </Text>
        </Pressable>
      )}
    />
  );
}

function EntityThings({
  entities,
  kind,
  inset,
}: {
  entities: TEntityRows;
  kind: string;
  inset: number;
}) {
  const router = useRouter();

  // Mentions to deleted messages are already excluded by the query, so an
  // entity with none left simply is not here: a deleted message cannot leave a
  // ghost address in the sidebar (plan §5.5).
  const rows = useMemo(
    () =>
      entities
        .filter((e) => e.kind === kind && e.mentions.length > 0)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [entities, kind],
  );

  if (rows.length === 0) return <EmptyScreen />;

  return (
    <TimelineEntities>
      <LegendList
        data={rows}
        keyExtractor={(entity: TEntityRow) => entity.id}
        estimatedItemSize={96}
        contentContainerStyle={{ gap: 6, padding: 12, paddingBottom: inset + 12 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }: { item: TEntityRow }) => (
          <EntityCard
            entity={item}
            mentions={item.mentions.length}
            onOpen={() => router.push(entityHref(item.id))}
          />
        )}
      />
    </TimelineEntities>
  );
}
