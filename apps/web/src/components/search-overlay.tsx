import type { TimelineSearchIndex } from "@ragbag/client-runtime";
import { faceForMime } from "@ragbag/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { FACE_ICON, Icon, iconNamed } from "@/components/icon";
import { MediaImage } from "@/components/media-image";
import { GroupLabel } from "@/components/typography";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useEntityTypes } from "@/lib/entity-types";
import { dayLabel, formatBytes } from "@/lib/format";
import { attachmentLink, entityLink, messageLink } from "@/lib/routes";
import { RESULT_GROUPS, useSearchResults, type Result, type ResultGroup } from "@/lib/search";
import { useViewStore } from "@/lib/store";
import type { Messages, EntityRows } from "@/lib/types";

// The single search box: a ⌘K overlay over the local index. Instant,
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
// cmdk owns keyboard navigation, selection and focus; `shouldFilter={false}`
// because the ranking is ours (minisearch), not cmdk's substring match.

const GROUP_LABEL: Record<ResultGroup, string> = {
  messages: "Messages",
  things: "Things",
};

/** One line describing what matched, and what it belongs to. */
function useDescribe(result: Result): {
  icon: React.ComponentProps<typeof Icon>["name"];
  /** A picture describes itself, so its row takes the icon's place with it. */
  thumb?: { blobId: string; placeholder: string | null };
  title: string;
  context: React.ReactNode;
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

  // A file is a thing of its own, so the row is the file: its own name, its own
  // reading, and the picture itself when it is one. The message it came in is
  // still where it opens, and the day on the right is that message's.
  if (result.attachment) {
    const { attachment } = result;
    const face = faceForMime(attachment.mime);
    const title = attachment.generatedTitle ?? attachment.filename;
    return {
      icon: FACE_ICON[face],
      thumb:
        face === "image"
          ? { blobId: attachment.blobId, placeholder: attachment.placeholder }
          : undefined,
      title,
      // The line a file gets everywhere else in the app (attachment-album.tsx,
      // things-view.tsx): the size is a reading and takes the mono, the name
      // beside it is a name and keeps the document's face. The filename only
      // earns its place when the title is not already it.
      context: (
        <>
          <span className="font-mono">{formatBytes(attachment.size)}</span>
          {title === attachment.filename ? "" : ` · ${attachment.filename}`}
        </>
      ),
      when: result.message?.createdAt ?? null,
    };
  }

  const message = result.message;
  if (!message) return { icon: "inbox", title: "", context: "", when: null };
  const messageTitle = message.generatedTitle ?? message.text?.split("\n")[0] ?? "(no text)";

  return {
    icon: "inbox",
    title: messageTitle,
    context:
      message.generatedSummary ??
      message.mentions
        .map((m) => m.entity?.value)
        .filter(Boolean)
        .join(" · "),
    when: message.createdAt,
  };
}

function ResultRow({ result, onPick }: { result: Result; onPick: () => void }) {
  const { icon, thumb, title, context, when } = useDescribe(result);
  return (
    <CommandItem value={result.hit.id} onSelect={onPick} className="gap-3 rounded-lg px-3 py-2.5">
      {/* One rail for every row, whether it holds a glyph or a photograph, so
          the titles line up down the list. 32px is the size at which a thumb
          is a picture rather than a coloured square, and it is still shorter
          than the two lines of text beside it. */}
      <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
        {thumb ? (
          // No alt text: the title is right beside it, and the picture is the
          // same fact said twice.
          <MediaImage
            blobId={thumb.blobId}
            variant="thumb"
            placeholder={thumb.placeholder}
            alt=""
          />
        ) : (
          /* text-current is load-bearing: CommandItem paints bare `svg`
             children muted-foreground, and the tint lives on the span. */
          <Icon name={icon} className="size-4 text-current" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {context && <span className="block truncate text-xs text-muted-foreground">{context}</span>}
      </span>
      {when !== null && (
        <span className="shrink-0 text-[11px] text-muted-foreground">{dayLabel(when)}</span>
      )}
    </CommandItem>
  );
}

export function SearchOverlay({
  index,
  messages,
  entities,
}: {
  index: TimelineSearchIndex;
  messages: Messages;
  entities: EntityRows;
}) {
  const { searchOpen, setSearchOpen } = useViewStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const results = useSearchResults(index, messages, entities, query);

  const grouped = useMemo(
    () =>
      RESULT_GROUPS.map((group) => ({
        group,
        rows: results.filter((r) => r.group === group),
      })).filter((g) => g.rows.length > 0),
    [results],
  );

  // ⌘K / Ctrl+K toggles from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen(!useViewStore.getState().searchOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen]);

  useEffect(() => {
    if (searchOpen) setQuery("");
  }, [searchOpen]);

  const pick = (result: Result) => {
    setSearchOpen(false);
    // Every row opens the thing it drew. A Things row is a thing whether it is
    // an entity or a file, and both have a page of their own; a Messages row
    // opens the message. The overlay opens over the view the search was called
    // from either way, and closing it lands back there.
    const to = result.entity
      ? entityLink(result.entity.id)
      : result.attachment
        ? attachmentLink(result.attachment.id)
        : result.message
          ? messageLink(result.message.id)
          : null;
    if (to) void navigate(to);
  };

  const blank = query.trim() === "";

  return (
    <CommandDialog
      open={searchOpen}
      onOpenChange={setSearchOpen}
      title="Search your archive"
      description="Search titles, tags, summaries and content in the local index."
      showCloseButton={false}
      // Anchored near the top rather than centred: a search palette that jumps
      // to the middle of the screen reads as a modal, not a command bar.
      className="top-[8vh] max-w-[calc(100%-1rem)] translate-y-0 rounded-2xl sm:max-w-xl md:top-[12vh]"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search everything…"
          value={query}
          onValueChange={setQuery}
          autoFocus
        />
        {/* The rows' fills line up with the field's: the palette is one column,
            and the surface a row highlights on is the same box the input draws.
            `px-1` is what the field's own wrapper takes (ui/command.tsx), and
            the 8px above and below is this list's own air, which the field has
            no use for. */}
        <CommandList className="max-h-[55vh] px-1 py-2">
          {blank ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Search messages and things found in them.
            </div>
          ) : (
            <>
              <CommandEmpty>Nothing found for “{query}”.</CommandEmpty>
              {grouped.map(({ group, rows }) => (
                <div key={group}>
                  <GroupLabel className="px-3 pb-1 pt-2">{GROUP_LABEL[group]}</GroupLabel>
                  {rows.map((result) => (
                    <ResultRow key={result.hit.id} result={result} onPick={() => pick(result)} />
                  ))}
                </div>
              ))}
            </>
          )}
        </CommandList>

        {!blank && results.length > 0 && (
          <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
            {results.length} result{results.length === 1 ? "" : "s"}
          </p>
        )}
      </Command>
    </CommandDialog>
  );
}
