import type { TimelineSearchIndex } from "@ragbag/client-runtime";
import { faceForMime } from "@ragbag/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { FACE_ICON, Icon, iconNamed } from "@/components/icon";
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
import { dayLabel } from "@/lib/format";
import { entityLink, messageLink, useFilter } from "@/lib/routes";
import { RESULT_GROUPS, useSearchResults, type Result, type ResultGroup } from "@/lib/search";
import { useViewStore } from "@/lib/store";
import type { Drop, EntityRows } from "@/lib/types";

// The single search box: a ⌘K overlay over the local index. Instant,
// search-as-you-type, fully offline.
//
// Two sections, and the split is the point (lib/search.ts, and `groupHits` in
// client-runtime):
//
//   Messages  which dump was this in. A message and the files inside it are one
//             row, naming the file when the file is why it is here.
//   Things    what is this thing. One row per thing, never folded into a message,
//             opening the thing's own page.
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
  title: string;
  context: string;
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

  const message = result.message;
  if (!message) return { icon: "inbox", title: "", context: "", when: null };
  const messageTitle = message.generatedTitle ?? message.text?.split("\n")[0] ?? "(no text)";

  // A file matched inside it: the message is still the row, but the file is what
  // to say, because "matched in scan.pdf" is the useful half.
  if (result.attachment) {
    const { attachment } = result;
    return {
      icon: FACE_ICON[faceForMime(attachment.mime)],
      title: messageTitle,
      context: attachment.generatedTitle ?? attachment.filename,
      when: message.createdAt,
    };
  }

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
  const { icon, title, context, when } = useDescribe(result);
  return (
    <CommandItem value={result.hit.id} onSelect={onPick} className="gap-3 rounded-lg px-3 py-2.5">
      <span className="flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {/* text-current is load-bearing: CommandItem paints bare `svg`
            children muted-foreground, and the tint lives on the span. */}
        <Icon name={icon} className="size-3.5 text-current" />
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
  messages: Drop;
  entities: EntityRows;
}) {
  const { searchOpen, setSearchOpen } = useViewStore();
  const navigate = useNavigate();
  const filter = useFilter();
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
    // A thing opens its own page; a message opens the message. Either way the
    // overlay opens over the view the search was called from, and closing it
    // lands back there.
    const to = result.entity
      ? entityLink(result.entity.id, filter)
      : result.message
        ? messageLink(result.message.id, filter)
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
        <CommandList className="max-h-[55vh] p-2">
          {blank ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Search everything: your words, what was read out of your files, and the things found
              in them.
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
            {results.length} result{results.length === 1 ? "" : "s"} · local index, works offline ·
            ↑↓ to move, Enter to open
          </p>
        )}
      </Command>
    </CommandDialog>
  );
}
