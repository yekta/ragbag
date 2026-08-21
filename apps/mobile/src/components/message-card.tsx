import type { TEntityFields, TMessage } from "@ragbag/client-runtime/rows";
import { mutators } from "@ragbag/contracts";
import { MenuView, type MenuAction } from "@react-native-menu/menu";
import { useZero } from "@rocicorp/zero/react";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { Alert, Linking, Pressable, View } from "react-native";
import Svg, { Line } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { AttachmentAlbum } from "@/components/attachment-album";
import { EntityCard } from "@/components/entities";
import { Icon } from "@/components/icon";
import { Text } from "@/components/text";
import { timeLabel } from "@/lib/format";
import { entityHref, messageHref } from "@/lib/routes";

// One timeline entry: the user's text, the attachments they sent with it, and
// whatever the pipeline found in the whole thing.
//
// Two cards in one silhouette, parted by a tear line: what the person sent,
// ending in its own timestamp, and below the perforation the stub holding what
// was read out of it. The message has to be legible as the thing they actually
// wrote, so the machine's findings hang off the bottom as an extra rather than
// sharing a box with it.
//
// A message that is one photo and nothing else renders as one photo and
// nothing else, because each part of the card only appears when there is
// something in it. That property falls out of the design rather than being
// special-cased anywhere.
//
// The one real departure from the web card is the actions. There they are a
// row of buttons on every card, because a browser has a pointer and no other
// idiom; here they are a native long-press menu, which is `UIMenu` on iOS and
// a Material popup on Android, so the card carries no furniture at all and
// every message in the archive is not a row of identical widgets saying
// nothing.

const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;

export function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <Text className="leading-relaxed">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text
            key={i}
            className="leading-relaxed text-kind-link underline"
            onPress={() => void Linking.openURL(part).catch(() => {})}
          >
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

/**
 * What ingestion is doing to this message, and how far along.
 *
 * "Reading 2 of 3" comes from the attachment rows rather than from a counter
 * on the message, because those are synced and the count is therefore live on
 * every device without a second column to keep in step.
 */
export function StatusChip({ message }: { message: TMessage }) {
  const zero = useZero();
  const { status } = message;
  if (status === "done") return null;

  if (status === "failed" || status === "partial") {
    const failed = status === "failed";
    return (
      // A soft chip rather than a solid red badge: the inline retry needs a
      // surface of its own, and lightening a solid fill would mean an alpha.
      <View
        className={`h-6 flex-row items-center gap-1.5 rounded-full px-2 ${
          failed ? "bg-destructive-soft" : "bg-warning"
        }`}
      >
        <Text className={`text-[11px] ${failed ? "text-destructive" : "text-warning-foreground"}`}>
          {failed ? "Failed" : "Partly read"}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={message.error ?? "Retry ingestion"}
          hitSlop={8}
          onPress={() => void zero.mutate(mutators.message.retryIngest({ id: message.id }))}
          className="flex-row items-center gap-0.5 rounded-full bg-card px-1.5 py-px active:bg-hover"
        >
          <Icon name="retry" size={12} />
          <Text className="text-[11px]">Retry</Text>
        </Pressable>
      </View>
    );
  }

  const parts = message.attachments.length;
  const done = message.attachments.filter((a) => a.status === "done").length;
  return (
    <View className="h-6 flex-row items-center gap-1 rounded-full bg-warning pl-1 pr-2">
      <Icon name="spinner" size={12} />
      <Text className="text-[11px] text-warning-foreground">
        {status === "processing"
          ? parts > 0
            ? `Reading ${Math.min(done + 1, parts)} of ${parts}`
            : "Reading"
          : "Queued"}
      </Text>
    </View>
  );
}

// Only the user's own tags appear in the timeline. AI tags are generous by
// design (a dozen per message would drown the cards), so they stay behind the
// detail sheet while still powering search and filtering.
export function TagChips({ message, limit = 8 }: { message: TMessage; limit?: number }) {
  const userTags = message.tags.filter((t) => t.tag && t.source === "user");
  if (userTags.length === 0) return null;
  const shown = userTags.slice(0, limit);
  return (
    <View className="flex-row flex-wrap items-center gap-1">
      {shown.map((t) => (
        <View key={t.tagId} className="h-6 justify-center rounded-full bg-secondary px-2">
          <Text className="text-[11px] text-secondary-foreground">{t.tag!.name}</Text>
        </View>
      ))}
      {userTags.length > shown.length ? (
        <Text className="text-[11px] text-muted-foreground">+{userTags.length - shown.length}</Text>
      ) : null}
    </View>
  );
}

/**
 * The distinct things a message mentions, in the order they were found.
 *
 * Deduped by entity: the same link found in the text and again inside a
 * screenshot is one card, not two, because a card describes the *thing*. Which
 * occurrences it came from is the entity page's business.
 *
 * A function rather than a line inside the strip below, because the detail
 * sheet lists the same set from the same relation, and two spellings of "what
 * this message mentions" is how a card and its own detail view come to
 * disagree about how many things are in a message.
 */
export function messageEntities(
  mentions: readonly { readonly entity?: TEntityFields | null }[],
): TEntityFields[] {
  const seen = new Set<string>();
  return mentions.flatMap((mention) => {
    const entity = mention.entity;
    if (!entity || seen.has(entity.id)) return [];
    seen.add(entity.id);
    return [entity];
  });
}

/**
 * The perforation the findings hang from.
 *
 * Drawn as an SVG dashed line rather than a dashed border, and the reason is
 * the same one the web app gives for using a gradient there: the dash pattern
 * has to be stated rather than inherited. React Native's `borderStyle:
 * "dashed"` is the platform's own rhythm, which differs between iOS and
 * Android and changes with the border width, so the seam would be a different
 * seam on each phone. `strokeDasharray` says 3 on, 2 off, everywhere.
 */
function Tear() {
  const border = useCSSVariable("--color-border") as string;
  return (
    <Svg height={1} width="100%">
      <Line
        x1="0"
        y1="0.5"
        x2="100%"
        y2="0.5"
        stroke={border}
        strokeWidth={1}
        strokeDasharray="3 2"
      />
    </Svg>
  );
}

/**
 * What the pipeline found in this message: the stub, and the tear it hangs
 * from.
 *
 * It only appears when there is something in it, which is why a message that
 * is one photo and nothing else renders as one photo and nothing else, and why
 * the perforation belongs to the stub rather than to the card: no findings, no
 * seam, and the card is a plain rounded rectangle again.
 */
function EntityStrip({ message }: { message: TMessage }) {
  const router = useRouter();
  const entities = messageEntities(message.mentions);
  if (entities.length === 0) return null;

  return (
    <>
      <Tear />
      {/* Tighter above than below: the tear is not a thing to crowd. */}
      <View className="p-3.5 pt-3">
        {/* The sparkles mark: everything under this label was found by the
            pipeline rather than written by the person, and the label is the
            one place on the card that can say so once for all of them. */}
        <View className="mb-2.5 flex-row items-center gap-1">
          <Icon name="sparkles" size={14} />
          <Text className="text-xs font-medium text-muted-foreground">Things found</Text>
        </View>
        <View className="gap-1.5">
          {entities.map((entity) => (
            <EntityCard
              key={entity.id}
              entity={entity}
              onOpen={() => router.push(entityHref(entity.id))}
            />
          ))}
        </View>
      </View>
    </>
  );
}

/**
 * What you can do to a message.
 *
 * A native long-press menu, which is the platform's answer to exactly this
 * question: `UIMenu` on iOS with its own blur, spring and haptic, a Material
 * popup on Android. The web card carries a star and an overflow button on
 * every row because a browser has no such thing; here the card carries no
 * furniture at all and the gesture is the one people already use on every
 * message in every other app on the phone.
 *
 * A favorited message still says so, because that is the message reporting
 * something about itself rather than the app offering a control: the star is
 * drawn only when it is filled.
 */
function useMessageMenu(message: TMessage) {
  const zero = useZero();

  const actions: MenuAction[] = [
    // `image` names an SF Symbol on iOS and a drawable on Android, and this
    // app ships no drawables: Android shows the titles alone, which is what
    // its own overflow menus look like anyway.
    {
      id: "favorite",
      title: message.favorite ? "Unfavorite" : "Favorite",
      image: message.favorite ? "star.slash" : "star",
    },
    {
      id: "details",
      title: "Show details",
      image: "list.bullet.rectangle",
    },
    {
      id: "delete",
      title: "Delete",
      image: "trash",
      attributes: { destructive: true },
    },
  ];

  return { actions, zero };
}

export function MessageCard({ message }: { message: TMessage }) {
  const router = useRouter();
  const { actions, zero } = useMessageMenu(message);
  // Read through uniwind rather than written as `var(--color-kind-note)`: a
  // native prop takes a colour, not a CSS expression, and only className goes
  // through the compiler that would resolve one.
  const noteInk = useCSSVariable("--color-kind-note") as string;

  const onAction = (id: string) => {
    if (id === "favorite") {
      void zero.mutate(
        mutators.message.setFavorite({ id: message.id, favorite: !message.favorite }),
      );
      return;
    }
    if (id === "details") {
      router.push(messageHref(message.id));
      return;
    }
    // The one destructive verb in the menu, and the platform's own confirm.
    // A message can carry photos that exist nowhere else, so this asks.
    Alert.alert("Delete this message?", "Its attachments and everything found in it go with it.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void zero.mutate(mutators.message.delete({ id: message.id })),
      },
    ]);
  };

  return (
    <MenuView
      title=""
      actions={actions}
      onPressAction={({ nativeEvent }) => onAction(nativeEvent.event)}
      shouldOpenOnLongPress
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open message details"
        onPress={() => router.push(messageHref(message.id))}
        onLongPress={() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
        // The card is an outlined region of the canvas rather than a sheet
        // raised off it, which is what leaves the cards and attachments inside
        // it a shade to rise by.
        className="overflow-hidden rounded-2xl border border-border bg-background active:bg-background-hover"
      >
        {/* The padding is here rather than on the card so the tear below can
            run the full width. */}
        <View className="p-3.5">
          {/* The air between what someone wrote and what they sent with it
              belongs to the pair rather than to either half, so it is a gap
              between the two and not padding on one of them. */}
          <View className="gap-1">
            {message.text ? (
              // A hair of inset on the text and none on the album: a picture
              // fills its box to the pixel while a letter carries its own side
              // bearing, so without this the text looks further out than the
              // photo under it.
              <View className="px-0.5">
                <Linkified text={message.text} />
              </View>
            ) : null}

            <AttachmentAlbum attachments={message.attachments} />
          </View>

          {/* The footer stands a chip tall whether or not there is a chip in
              it. Ingestion is the one thing on a card that changes on its own,
              with no one touching it: a badge appears the moment a message
              lands, counts up through the parts, then leaves. Without a floor
              every card below would jump by the difference, twice, per
              message. */}
          <View className="mt-3 min-h-6 flex-row flex-wrap items-center justify-between gap-2 px-0.5">
            <View className="min-w-0 shrink flex-row flex-wrap items-center gap-1.5">
              <StatusChip message={message} />
              <TagChips message={message} />
            </View>
            <View className="ml-auto flex-row shrink-0 items-center gap-1.5">
              {message.favorite ? <Icon name="star" size={14} filled color={noteInk} /> : null}
              <Text className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {timeLabel(message.createdAt)}
              </Text>
            </View>
          </View>
        </View>

        <EntityStrip message={message} />
      </Pressable>
    </MenuView>
  );
}
