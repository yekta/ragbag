import type { TimelineSearchIndex } from "@ragbag/client-runtime";
import { entityLabel, faceForMime } from "@ragbag/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { FACE_ICON, Icon, entityIcon } from "@/components/icon";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { dayLabel } from "@/lib/format";
import { entityLink, messageLink, useFilter } from "@/lib/routes";
import { RESULT_GROUPS, useSearchResults, type Result, type ResultGroup } from "@/lib/search";
import { useViewStore } from "@/lib/store";
import type { Drop } from "@/lib/types";

// The single search box: a ⌘K overlay over the local index. Instant,
// search-as-you-type, fully offline.
//
// Results group under Messages / Images / Files / Things, and collapse: an
// attachment or entity hit whose message also hit folds into the message row
// rather than appearing twice (lib/search.ts).
//
// cmdk owns keyboard navigation, selection and focus; `shouldFilter={false}`
// because the ranking is ours (minisearch), not cmdk's substring match.

const GROUP_LABEL: Record<ResultGroup, string> = {
  messages: "Messages",
  images: "Images",
  files: "Files",
  things: "Things",
};

/** One line describing what matched, and what it belongs to. */
function describe(result: Result): {
  icon: React.ComponentProps<typeof Icon>["name"];
  title: string;
  context: string;
} {
  const { message } = result;
  const messageTitle = message.generatedTitle ?? message.text?.split("\n")[0] ?? "(no text)";

  if (result.attachmentId) {
    const attachment = message.attachments.find((a) => a.id === result.attachmentId);
    return {
      icon: FACE_ICON[faceForMime(attachment?.mime ?? "")],
      title: attachment?.generatedTitle ?? attachment?.filename ?? "file",
      context: messageTitle,
    };
  }
  if (result.entityId) {
    const entity = message.mentions.find((m) => m.entityId === result.entityId)?.entity;
    return {
      icon: entityIcon(entity?.kind ?? ""),
      title: entity?.generatedTitle ?? entity?.value ?? "thing",
      context: entity ? entityLabel(entity.kind) : messageTitle,
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
  };
}

function ResultRow({ result, onPick }: { result: Result; onPick: () => void }) {
  const { icon, title, context } = describe(result);
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
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {dayLabel(result.message.createdAt)}
      </span>
    </CommandItem>
  );
}

export function SearchOverlay({ index, messages }: { index: TimelineSearchIndex; messages: Drop }) {
  const { searchOpen, setSearchOpen } = useViewStore();
  const navigate = useNavigate();
  const filter = useFilter();
  const [query, setQuery] = useState("");
  const results = useSearchResults(index, messages, query);

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
    // A thing opens its own page; everything else opens the message it is in.
    // Either way the overlay opens over the view the search was called from,
    // and closing it lands back there.
    void navigate(
      result.entityId
        ? entityLink(result.entityId, filter)
        : messageLink(result.message.id, filter),
    );
  };

  const blank = query.trim() === "";

  return (
    <CommandDialog
      open={searchOpen}
      onOpenChange={setSearchOpen}
      title="Search your ragbag"
      description="Search titles, tags, summaries and content in the local index."
      showCloseButton={false}
      // Anchored near the top rather than centred: a search palette that jumps
      // to the middle of the screen reads as a modal, not a command bar.
      className="top-[8vh] max-w-[calc(100%-1rem)] translate-y-0 rounded-2xl sm:max-w-xl md:top-[12vh]"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search your ragbag…"
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
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {GROUP_LABEL[group]}
                  </p>
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
