import { queries } from "@ragbag/contracts";
import { faceForMime } from "@ragbag/shared";
import { useQuery } from "@rocicorp/zero/react";
import { LegendList } from "@legendapp/list/react-native";
import { useRouter } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { Keyboard, Pressable, TextInput, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { FACE_ICON, Icon, iconNamed, type TIconName } from "@/components/icon";
import { MediaImage } from "@/components/media-image";
import { Text } from "@/components/text";
import { useEntityTypes } from "@/features/session/entity-types";
import { WHOLE_ARCHIVE } from "@/features/workspace/workspace-provider";
import { dayLabel, formatBytes } from "@/lib/format";
import { attachmentHref, entityHref, messageHref } from "@/lib/routes";
import {
  RESULT_GROUPS,
  useSearchResults,
  useTimelineSearch,
  type TResult,
  type TResultGroup,
} from "@/lib/search";

// The single search box: a screen over the local index. Instant,
// search-as-you-type, fully offline.
//
// Two sections, and the split is the point (lib/search.ts, and `groupHits` in
// client-runtime):
//
//   Messages  which message was this in. One row per message.
//   Things    what is this thing. The pictures and files inside messages as
//             much as what the pipeline found in them, because that is what
//             the sidebar files under Things: one row each, never folded into
//             a message, and a picture's row is the picture.
//
// A pushed screen rather than the web's ⌘K palette, for a reason the web app
// does not have: there is no keyboard to summon a palette with, and a modal
// that covers the archive while the soft keyboard covers the other half of it
// leaves about a third of the screen for results. A screen gets all of it.
//
// A result opens *over* the results rather than in place of them. It used to
// replace this screen, which meant asking the navigator to swap a modal for a
// form sheet after it had already presented one; and even where that worked, a
// search you had to type again to see the second result was the wrong shape.

const GROUP_LABEL: Record<TResultGroup, string> = {
  messages: "Messages",
  things: "Things",
};

type TRow =
  | { type: "heading"; key: string; label: string }
  | { type: "result"; key: string; result: TResult };

export default function SearchScreen() {
  const [messages] = useQuery(queries.messages(WHOLE_ARCHIVE));
  const [entities] = useQuery(queries.entities());
  const [contents] = useQuery(queries.contents());
  const types = useEntityTypes();
  const [query, setQuery] = useState("");
  const router = useRouter();
  const placeholderInk = useCSSVariable("--color-muted-foreground") as string;
  const ink = useCSSVariable("--color-foreground") as string;

  const index = useTimelineSearch(messages, contents, entities, types);
  const results = useSearchResults(index, messages, entities, query);

  const rows = useMemo(() => {
    const out: TRow[] = [];
    for (const group of RESULT_GROUPS) {
      const inGroup = results.filter((r) => r.group === group);
      if (inGroup.length === 0) continue;
      out.push({ type: "heading", key: `heading:${group}`, label: GROUP_LABEL[group] });
      for (const result of inGroup) {
        out.push({ type: "result", key: result.hit.id, result });
      }
    }
    return out;
  }, [results]);

  const pick = (result: TResult) => {
    // Every row opens the thing it drew. A Things row is a thing whether it is
    // an entity or a file, and both have a page of their own; a Messages row
    // opens the message.
    const href = result.entity
      ? entityHref(result.entity.id)
      : result.attachment
        ? attachmentHref(result.attachment.id)
        : result.message
          ? messageHref(result.message.id)
          : null;
    if (!href) return;
    // Before the push, not after: a sheet presented while the soft keyboard is
    // still up comes in over a screen that is about to resize under it.
    Keyboard.dismiss();
    router.push(href);
  };

  const blank = query.trim() === "";

  return (
    <View className="flex-1 bg-background">
      <View className="border-b border-border px-3 pb-2 pt-1">
        <View className="h-11 flex-row items-center gap-2 rounded-lg bg-panel px-3">
          <Icon name="search" size={16} />
          <TextInput
            className="flex-1 text-base"
            style={{ color: ink }}
            placeholder="Search everything…"
            placeholderTextColor={placeholderInk}
            value={query}
            onChangeText={setQuery}
            // The one screen in the app that should open with the keyboard up:
            // it exists to be typed into and has nothing else to show.
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            // A native clear affordance rather than one drawn here.
            clearButtonMode="while-editing"
            accessibilityLabel="Search your archive"
          />
        </View>
      </View>

      {blank ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-sm text-muted-foreground">
            Search messages and things found in them.
          </Text>
        </View>
      ) : rows.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-sm text-muted-foreground">
            Nothing found for “{query.trim()}”.
          </Text>
        </View>
      ) : (
        <LegendList
          data={rows}
          keyExtractor={(row: TRow) => row.key}
          estimatedItemSize={64}
          contentContainerClassName="pb-8"
          // Typing is what this screen is for, so a tap on a result must land
          // without the keyboard closing first and moving the row out from
          // under the thumb.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          renderItem={({ item }: { item: TRow }) =>
            item.type === "heading" ? (
              <Text className="px-4 pb-1 pt-3 text-xs font-semibold text-muted-foreground">
                {item.label}
              </Text>
            ) : (
              <ResultRow result={item.result} onPick={() => pick(item.result)} />
            )
          }
        />
      )}
    </View>
  );
}

/** One line describing what matched, and what it belongs to. */
function useDescribe(result: TResult): {
  icon: TIconName;
  /** A picture describes itself, so its row takes the icon's place with it. */
  thumb?: TResult["attachment"];
  title: string;
  context: ReactNode;
  when: number | null;
} {
  const types = useEntityTypes();

  if (result.entity) {
    const { entity } = result;
    const mentions = entity.mentions.length;
    return {
      icon: iconNamed(types.icon(entity.kind)),
      title: entity.generatedTitle ?? entity.value,
      context: [types.label(entity.kind), mentions > 1 ? `seen in ${mentions} messages` : null]
        .filter(Boolean)
        .join(" · "),
      when: entity.firstSeenAt,
    };
  }

  // A file is a thing of its own, so the row is the file: its own name, its
  // own reading, and the picture itself when it is one.
  if (result.attachment) {
    const { attachment } = result;
    const face = faceForMime(attachment.mime);
    const title = attachment.generatedTitle ?? attachment.filename;
    return {
      icon: FACE_ICON[face],
      thumb: face === "image" ? attachment : undefined,
      title,
      context: (
        <Text className="text-xs text-muted-foreground">
          <Text className="font-mono text-xs text-muted-foreground">
            {formatBytes(attachment.size)}
          </Text>
          {title === attachment.filename ? "" : ` · ${attachment.filename}`}
        </Text>
      ),
      when: result.message?.createdAt ?? null,
    };
  }

  const message = result.message;
  if (!message) return { icon: "inbox", title: "", context: "", when: null };

  return {
    icon: "inbox",
    title: message.generatedTitle ?? message.text?.split("\n")[0] ?? "(no text)",
    context:
      message.generatedSummary ??
      message.mentions
        .map((m) => m.entity?.value)
        .filter(Boolean)
        .join(" · "),
    when: message.createdAt,
  };
}

function ResultRow({ result, onPick }: { result: TResult; onPick: () => void }) {
  const { icon, thumb, title, context, when } = useDescribe(result);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPick}
      className="min-h-14 flex-row items-center gap-3 px-4 py-2.5 active:bg-hover"
    >
      {/* One rail for every row, whether it holds a glyph or a photograph, so
          the titles line up down the list. 32pt is the size at which a thumb
          is a picture rather than a coloured square, and it is still shorter
          than the two lines of text beside it. */}
      <View className="size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {thumb ? (
          <MediaImage attachment={thumb} variant="thumb" style={{ width: 32, height: 32 }} />
        ) : (
          <Icon name={icon} size={16} />
        )}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-medium" numberOfLines={1}>
          {title}
        </Text>
        {context ? (
          typeof context === "string" ? (
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
              {context}
            </Text>
          ) : (
            context
          )
        ) : null}
      </View>
      {when !== null ? (
        <Text className="shrink-0 text-[11px] text-muted-foreground">{dayLabel(when)}</Text>
      ) : null}
    </Pressable>
  );
}
