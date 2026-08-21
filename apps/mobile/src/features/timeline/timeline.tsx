import type { TMessage, TMessages } from "@ragbag/client-runtime/rows";
// The React Native entry point specifically. The bare specifier has no
// default export condition, and the package also ships Reanimated and
// animated variants; this app wants the plain one.
import { LegendList } from "@legendapp/list/react-native";
import { useMemo } from "react";
import { View } from "react-native";
import { EmptyArchive, EmptyScreen } from "@/components/empty-screen";
import { MessageCard } from "@/components/message-card";
import { Text } from "@/components/text";
import { dayKey, dayLabel } from "@/lib/format";
import { useFilter } from "@/lib/routes";

// The chat: the whole archive, oldest at the top, anchored to the bottom like
// a messenger.
//
// This is where the web app's timeline and this one diverge most, and almost
// all of it is subtraction. That file carries about 150 lines of height
// estimation (a character-count model of how tall a paragraph wraps, a table
// of constants for every kind of attachment block) because
// `useWindowVirtualizer` has to be told how tall a row will be before it
// exists, and it pays for every error by resizing the document under the
// reader. LegendList measures rows as they mount and corrects the offset
// itself, so `estimatedItemSize` is a hint rather than a model.
//
// The two behaviours a chat needs are props here rather than effects:
// `alignItemsAtEnd` puts a short archive at the bottom of the screen instead
// of the top, and `maintainScrollAtEnd` keeps you pinned to the newest message
// when one arrives *while you are already there*, and leaves you alone when
// you are reading history. Both of those took a scroll listener and a measured
// threshold on the web.

type TRow =
  { type: "day"; key: string; label: string } | { type: "message"; key: string; message: TMessage };

/**
 * A guess at a card's height, used only to size the scroll indicator before
 * rows have mounted. Wrong is cheap here in a way it is not on the web:
 * LegendList replaces it with the real measurement on first layout.
 */
const ESTIMATED_ROW = 220;

function useRows(messages: TMessages): TRow[] {
  // The route is the filter (lib/routes.ts).
  const { view, tagId } = useFilter();
  return useMemo(() => {
    // Messages arrive newest-first from the shared query; the chat renders
    // oldest-first.
    let filtered = messages.toReversed();
    if (view === "favorites") filtered = filtered.filter((m) => m.favorite);
    if (tagId) filtered = filtered.filter((m) => m.tags.some((t) => t.tagId === tagId));

    const rows: TRow[] = [];
    let lastDay = "";
    for (const message of filtered) {
      const key = dayKey(message.createdAt);
      if (key !== lastDay) {
        rows.push({ type: "day", key: `day:${key}`, label: dayLabel(message.createdAt) });
        lastDay = key;
      }
      rows.push({ type: "message", key: message.id, message });
    }
    return rows;
  }, [messages, view, tagId]);
}

export function Timeline({ messages }: { messages: TMessages }) {
  const rows = useRows(messages);
  const filter = useFilter();

  if (rows.length === 0) {
    // Two different facts, and only one of them is worth a "send something".
    // An archive with messages in it that this view does not hold is not an
    // empty archive.
    return messages.length === 0 && !filter.view && !filter.tagId ? (
      <EmptyArchive />
    ) : (
      <EmptyScreen />
    );
  }

  return (
    <LegendList
      data={rows}
      keyExtractor={(row: TRow) => row.key}
      estimatedItemSize={ESTIMATED_ROW}
      // A short archive sits at the bottom of the screen, above the composer,
      // rather than stranded at the top of an empty column.
      alignItemsAtEnd
      // Pinned to the newest message when a new one lands and you are already
      // at the bottom; left alone when you are reading history.
      maintainScrollAtEnd
      // A message arriving above the viewport (another device's, or an
      // ingestion result changing a card's height) must not drag what you are
      // reading. This is the native form of the anchoring the web timeline
      // does by hand.
      maintainVisibleContentPosition
      renderItem={({ item }: { item: TRow }) =>
        item.type === "day" ? (
          <DaySeparator label={item.label} />
        ) : (
          <View className="px-3 pb-2.5">
            <MessageCard message={item.message} />
          </View>
        )
      }
      contentContainerClassName="pt-3"
      showsVerticalScrollIndicator={false}
      // The keyboard belongs to the composer below, and a scroll is a
      // deliberate move away from it.
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    />
  );
}

/**
 * The date, between the last message of one day and the first of the next.
 *
 * Not sticky. It is on the web, where a pointer can rest anywhere in a long
 * day and the header is the only thing saying which one; here the list is
 * thumbed through in bursts and a chip pinned under the navigation bar is one
 * more thing between the reader and the archive.
 */
function DaySeparator({ label }: { label: string }) {
  return (
    <View className="items-center py-3">
      <View className="rounded-full bg-panel px-2.5 py-1">
        <Text className="text-[11px] font-medium text-muted-foreground">{label}</Text>
      </View>
    </View>
  );
}
