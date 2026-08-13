import type { TimelineSearchIndex } from "@ragbag/client-runtime";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { KindDot } from "@/components/item-card";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { dayLabel, hostOf } from "@/lib/format";
import { useSearchResults } from "@/lib/search";
import { useViewStore } from "@/lib/store";
import type { Timeline, TimelineItem } from "@/lib/types";

// The single search box (plan §8/§10): a ⌘K overlay over the Tier-1 local
// index. Instant, search-as-you-type, fully offline. Tier 2 blends into this
// same box in M7 — hybrid ranking, not a separate mode.
//
// cmdk owns keyboard navigation, selection and focus; `shouldFilter={false}`
// because the ranking is ours (minisearch), not cmdk's substring match.

function ResultRow({ item, onPick }: { item: TimelineItem; onPick: () => void }) {
  const title = item.content?.title ?? item.text?.split("\n")[0] ?? item.url ?? `(${item.kind})`;
  const context = item.content?.aiSummary ?? item.content?.description ?? hostOf(item.url) ?? "";
  return (
    <CommandItem value={item.id} onSelect={onPick} className="gap-3 rounded-xl px-3 py-2.5">
      <KindDot kind={item.kind} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {context && <span className="block truncate text-xs text-muted-foreground">{context}</span>}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{dayLabel(item.createdAt)}</span>
    </CommandItem>
  );
}

export function SearchOverlay({ index, items }: { index: TimelineSearchIndex; items: Timeline }) {
  const { searchOpen, setSearchOpen } = useViewStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const results = useSearchResults(index, items, query);

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

  const pick = (item: TimelineItem) => {
    setSearchOpen(false);
    void navigate({ to: "/item/$id", params: { id: item.id } });
  };

  const blank = query.trim() === "";

  return (
    <CommandDialog
      open={searchOpen}
      onOpenChange={setSearchOpen}
      title="Search your ragbag"
      description="Search titles, tags, summaries and content in the local index."
      commandProps={{ shouldFilter: false }}
      showCloseButton={false}
      // Anchored near the top rather than centred: a search palette that jumps
      // to the middle of the screen reads as a modal, not a command bar.
      className="top-[8vh] max-w-xl translate-y-0 rounded-2xl md:top-[12vh]"
    >
      <CommandInput
        placeholder="Search your ragbag…"
        value={query}
        onValueChange={setQuery}
        autoFocus
      />
      <CommandList className="max-h-[55vh] p-2">
        {blank ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            Type to search titles, tags, summaries, and content — instant and offline.
          </div>
        ) : (
          <>
            <CommandEmpty>Nothing found for “{query}”.</CommandEmpty>
            {results.map((item) => (
              <ResultRow key={item.id} item={item} onPick={() => pick(item)} />
            ))}
          </>
        )}
      </CommandList>

      {!blank && results.length > 0 && (
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
          {results.length} result{results.length === 1 ? "" : "s"} · local index, works offline · ↑↓
          to move, Enter to open
        </p>
      )}
    </CommandDialog>
  );
}
