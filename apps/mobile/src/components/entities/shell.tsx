import type { TEntityFields } from "@ragbag/client-runtime/rows";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { createContext, use, useState, type ReactNode } from "react";
import { Linking, Pressable, View } from "react-native";
import { Icon, iconNamed, type TIconName } from "@/components/icon";
import { Text } from "@/components/text";
import { useEntityTypes } from "@/features/session/entity-types";

// What every entity card is made of. One shell so the strip on a message reads
// as one thing rather than as six differently-shaped boxes, and so a new kind
// is a file that fills in slots rather than a new layout.
//
// Two surfaces, and the rule is where the card is rather than what it holds: a
// row *in* a timeline is a card in its own right, drawn the way a message is,
// and a card *inside* a message is a chip on top of one. Both are bordered,
// and the fill says which is which as plainly as the corner does: a row
// sitting on the canvas takes the page's own fill, so its border is the whole
// card, while a nested one takes the card fill and reads as something laid on
// the message rather than cut into it. Which is why this is a context rather
// than a prop: the six cards forward nothing, and the list that draws them
// says once, for all of them, where they are.

type TSurface = "timeline" | "nested";

const SurfaceContext = createContext<TSurface>("nested");

/** Wraps a list of cards that ARE the timeline, rather than sitting in one. */
export function TimelineEntities({ children }: { children: ReactNode }) {
  return <SurfaceContext value="timeline">{children}</SurfaceContext>;
}

/**
 * How many messages the thing on a card was seen in. A context for the same
 * reason the surface is one: the cards forward nothing, and `EntityCard` is the
 * one place that sees both the count and every shell that could draw it.
 */
export const MentionsContext = createContext(0);

export type TEntityCardProps = {
  entity: TEntityFields;
  /** Opens the entity's own page. Absent where there is nowhere to go. */
  onOpen?: () => void;
  /**
   * How many messages it was seen in, where that is worth saying. The things
   * list passes it; a message's strip does not (its entities do not carry
   * their mentions), nor does the entity page, which lists them in full below.
   */
  mentions?: number;
};

/** Read a string out of an entity's per-kind `data` without trusting it. */
export function str(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function num(data: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function EntityShell({
  kind,
  title,
  subtitle,
  actions,
  media,
  onOpen,
}: {
  kind: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** A preview image, for the kinds that have one. */
  media?: ReactNode;
  onOpen?: () => void;
}) {
  // A type carries its icon in Postgres, so it is looked up per render rather
  // than baked into a map at module scope.
  const icon = iconNamed(useEntityTypes().icon(kind));
  const timeline = use(SurfaceContext) === "timeline";
  // One mention is every thing in the list, so saying it says nothing.
  const mentions = use(MentionsContext);

  // Every corner answers to the one outside it. A nested card sits inside a
  // message's own 16pt corner, so concentric would be tiny and this is
  // deliberately two rungs above it: what is left of a curve at that depth
  // reads as a box someone clipped rather than as a card of its own. A
  // timeline row has nothing outside it and takes the message's own corner.
  const surface = timeline
    ? "rounded-2xl border border-border bg-background p-3.5"
    : "rounded-md border border-border bg-card p-3";
  const iconBox = timeline ? "rounded-md" : "rounded-sm";
  // The press is the whole of the feedback here: there is no pointer to hover
  // with, so a fill that only exists under one is a control that never
  // acknowledges a tap. The actions inside are their own Pressables and stop
  // the touch from reaching this one, which is React Native's default for a
  // nested pressable rather than something this has to police.
  const pressed = onOpen ? "active:bg-background-hover" : "";

  return (
    <Pressable
      accessibilityRole={onOpen ? "button" : "summary"}
      disabled={!onOpen}
      onPress={onOpen}
      className={`flex-row gap-3 ${surface} ${pressed}`}
    >
      <View className={`size-9 shrink-0 items-center justify-center bg-muted ${iconBox}`}>
        <Icon name={icon} size={16} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-medium" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? <View className="mt-0.5">{subtitle}</View> : null}
        {/* The count rides the action row rather than a line of its own: that
            row is the one part of a card every kind has, whatever its subtitle
            holds, and a line under the card was a caption floating between two
            of them, belonging to the one below as much as the one above. */}
        {actions || mentions > 1 ? (
          <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
            {actions}
            {mentions > 1 ? (
              <Text className="ml-0.5 text-[11px] text-muted-foreground">
                seen in {mentions} messages
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      {media}
    </Pressable>
  );
}

/** The small bordered control an entity card's actions are made of. */
function ActionChip({
  icon,
  label,
  onPress,
}: {
  icon: TIconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      // 32pt rather than the 44 a bare control would take: these sit in a row
      // inside a card that is itself a tap target, and a 44pt chip in a 60pt
      // card is a card you cannot tap. The hit slop buys the difference back
      // without the chip drawing at that size.
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      className="h-8 flex-row items-center gap-1 rounded-md border border-border bg-card px-2 active:bg-background-hover"
    >
      <Icon name={icon} size={12} />
      <Text className="text-xs font-medium">{label}</Text>
    </Pressable>
  );
}

/** Copy, with the one beat of feedback that says it worked. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <ActionChip
      icon={copied ? "check" : "copy"}
      label={copied ? "Copied" : label}
      onPress={() => {
        void Clipboard.setStringAsync(value).then(() => {
          // The tap is the confirmation on a phone. The label change alone is
          // easy to miss under a thumb that is covering it.
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setCopied(true);
          setTimeout(() => setCopied(false), 1_500);
        });
      }}
    />
  );
}

/**
 * An action that leaves the app: maps, a carrier's tracking page, a mailto, a
 * tel.
 *
 * `openURL` rather than a browser: `tel:` and `mailto:` have to reach the
 * system, and a maps link opens in Maps rather than in a web view, which is
 * the whole reason someone taps it.
 */
export function ExternalAction({
  href,
  children,
  icon = "external",
}: {
  href: string;
  children: string;
  icon?: TIconName;
}) {
  return (
    <ActionChip
      icon={icon}
      label={children}
      onPress={() => {
        void Linking.openURL(href).catch(() => {
          // Nothing on this device handles the scheme (no mail account, no
          // dialer on a tablet). Silent: the value is on the card and the copy
          // button beside this one still works.
        });
      }}
    />
  );
}
