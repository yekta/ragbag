import { queries } from "@ragbag/contracts";
import type { TEntityTypes } from "@ragbag/shared";
import { useQuery } from "@rocicorp/zero/react";
import { View } from "react-native";
import { FACE_ICON, Icon, iconNamed, type TIconName } from "@/components/icon";
import { Text } from "@/components/text";
import { useEntityTypes } from "@/features/session/entity-types";
import {
  attachmentFaceOf,
  entityKindOf,
  isChatView,
  useFilter,
  type TViewFilter,
} from "@/lib/routes";

// What a screen says when there is nothing on it yet.
//
// One screen for every view, because every view is the same sentence with its
// own noun in it, and the noun is the route's own segment (lib/routes.ts):
// `/favorites` says favorites, `/images` says images, and a kind someone
// declares tomorrow says its own name here with no code change at all. The
// icon comes from where the sidebar row's icon comes from, so "no links yet"
// cannot end up under a picture of an inbox.
//
// Not the same fact as an empty archive, which the timeline answers for
// itself: nothing has ever been sent, and this view holds none of it, are two
// different things, and only the first is worth a "send something below".

/** The icon and the plural noun the route is asking for. */
function viewFace(view: TViewFilter, types: TEntityTypes): { icon: TIconName; noun: string } {
  // The slug is already the plural noun, which is what the vocabulary being
  // the route buys: `/images` is images.
  const face = attachmentFaceOf(view);
  if (face) return { icon: FACE_ICON[face], noun: view! };
  const kind = entityKindOf(view, types);
  if (kind) {
    return { icon: iconNamed(types.icon(kind)), noun: types.sidebarTitle(kind).toLowerCase() };
  }
  if (view === "favorites") return { icon: "star", noun: "favorites" };
  return { icon: "inbox", noun: "messages" };
}

export function EmptyScreen() {
  const filter = useFilter();
  const types = useEntityTypes();
  // Already preloaded, so this is a read of the local store rather than a
  // fetch, and one that cannot disagree with the row that got you here.
  const [tags] = useQuery(queries.tags());
  const { icon, noun } = viewFace(filter.view, types);
  // A tag narrows the chat and nothing else (lib/routes.ts), so it only names
  // the screen where it is the thing doing the narrowing.
  const tag =
    filter.tagId && isChatView(filter.view) ? tags.find((t) => t.id === filter.tagId) : undefined;

  // One line, one colour: the icon and the sentence are the same statement, so
  // a heading weight over a dimmer second line only makes a two-storey thing
  // out of a fact that fits in a sentence.
  return (
    <View className="flex-1 items-center justify-center gap-3 px-6 py-20">
      <Icon name={icon} size={40} />
      <Text className="text-center text-sm text-muted-foreground">
        {tag
          ? `You don't have any ${noun} tagged “${tag.name}” yet.`
          : `You don't have any ${noun} yet.`}
      </Text>
    </View>
  );
}

/** The archive itself is empty: nothing has ever been sent from any device. */
export function EmptyArchive() {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-6 py-20">
      <Icon name="inbox" size={40} />
      <Text className="text-center text-sm text-muted-foreground">
        Send anything below: a thought, a link, a photo. It becomes searchable, offline, forever.
      </Text>
    </View>
  );
}
