import { queries } from "@ragbag/contracts";
import type { EntityTypes } from "@ragbag/shared";
import { useQuery } from "@rocicorp/zero/react";
import { FACE_ICON, Icon, iconNamed, type IconName } from "@/components/icon";
import { useEntityTypes } from "@/lib/entity-types";
import {
  attachmentFaceOf,
  entityKindOf,
  isChatView,
  useFilter,
  type ViewFilter,
} from "@/lib/routes";

// What a page says when there is nothing on it yet.
//
// One screen for every view, because every view is the same sentence with its
// own noun in it, and the noun is the URL's own segment (lib/routes.ts):
// `/favorites` says favorites, `/images` says images, and a kind someone
// declares in Postgres tomorrow says its own name here with no code change at
// all. The icon comes from where the sidebar row's icon comes from, so "no
// links yet" cannot end up under a picture of an inbox.
//
// Not the same fact as an empty archive, which the timeline still answers for
// itself: nothing has ever been dropped and this page holds none of it are two
// different things, and only the first one is worth a "drop something below".

/** The icon and the plural noun the URL is asking for. */
function viewFace(view: ViewFilter, types: EntityTypes): { icon: IconName; noun: string } {
  // The slug is already the plural noun, which is what the vocabulary being the
  // URL buys: `/images` is images.
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
  // The list the sidebar names its tag rows from, already preloaded (app.tsx):
  // a read of the local store rather than a fetch, and one that cannot disagree
  // with the row that got you here.
  const [tags] = useQuery(queries.tags());
  const { icon, noun } = viewFace(filter.view, types);
  // A tag narrows the chat and nothing else (lib/routes.ts), so it only names
  // the screen where it is the thing doing the narrowing.
  const tag =
    filter.tagId && isChatView(filter.view) ? tags.find((t) => t.id === filter.tagId) : undefined;

  // One line, one colour: the icon and the sentence are the same statement, so
  // a heading weight over a dimmer second line only made a two-storey thing out
  // of a fact that fits in a sentence. Same shape as the empty archive
  // (components/timeline.tsx), which is the screen this one stands next to.
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-20 text-center text-muted-foreground">
      <Icon name={icon} className="size-10" />
      <p className="text-sm">
        {tag
          ? `You don't have any ${noun} tagged “${tag.name}” yet.`
          : `You don't have any ${noun} yet.`}
      </p>
    </div>
  );
}
