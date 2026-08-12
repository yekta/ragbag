import type { TimelineSearchIndex } from "@ragbag/client-runtime";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { dayLabel, hostOf } from "../lib/format.js";
import { useSearchResults } from "../lib/search.js";
import { useViewStore } from "../lib/store.js";
import type { Timeline, TimelineItem } from "../lib/types.js";
import { Icon } from "./Icon.js";
import { KindDot } from "./ItemCard.js";

// The single search box (plan §8/§10): a ⌘K overlay over the Tier-1 local
// index. Instant, search-as-you-type, fully offline. Tier 2 blends into this
// same box in M7 — hybrid ranking, not a separate mode.

function ResultRow({
  item,
  active,
  onPick,
  onHover,
}: {
  item: TimelineItem;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  const title = item.content?.title ?? item.text?.split("\n")[0] ?? item.url ?? `(${item.kind})`;
  const context = item.content?.aiSummary ?? item.content?.description ?? hostOf(item.url) ?? "";
  return (
    <button
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
        active ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"
      }`}
      onClick={onPick}
      onMouseMove={onHover}
    >
      <KindDot kind={item.kind} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {context && (
          <span
            className={`block truncate text-xs ${active ? "text-neutral-300" : "text-neutral-400"}`}
          >
            {context}
          </span>
        )}
      </span>
      <span className={`shrink-0 text-[11px] ${active ? "text-neutral-300" : "text-neutral-400"}`}>
        {dayLabel(item.createdAt)}
      </span>
    </button>
  );
}

export function SearchOverlay({ index, items }: { index: TimelineSearchIndex; items: Timeline }) {
  const { searchOpen, setSearchOpen } = useViewStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
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
    if (searchOpen) {
      setQuery("");
      setSelected(0);
      // Focus after the overlay paints.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [searchOpen]);

  useEffect(() => setSelected(0), [query]);

  if (!searchOpen) return null;

  const close = () => setSearchOpen(false);
  const pick = (item: TimelineItem) => {
    close();
    void navigate({ to: "/item/$id", params: { id: item.id } });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-neutral-900/30 pt-[12vh]">
      <div className="absolute inset-0" onClick={close} />
      <div className="relative flex max-h-[65vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-neutral-200 px-4">
          <Icon name="search" className="size-4 shrink-0 text-neutral-400" />
          <input
            ref={inputRef}
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-neutral-400"
            placeholder="Search your ragbag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => Math.min(s + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter" && results[selected]) {
                pick(results[selected]);
              }
            }}
          />
          <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[10px] text-neutral-400">
            esc
          </kbd>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {query.trim() === "" ? (
            <p className="px-3 py-6 text-center text-sm text-neutral-400">
              Type to search titles, tags, summaries, and content — instant and offline.
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-neutral-400">
              Nothing found for “{query}”.
            </p>
          ) : (
            results.map((item, i) => (
              <ResultRow
                key={item.id}
                item={item}
                active={i === selected}
                onPick={() => pick(item)}
                onHover={() => setSelected(i)}
              />
            ))
          )}
        </div>

        {query.trim() !== "" && results.length > 0 && (
          <p className="border-t border-neutral-100 px-4 py-2 text-[11px] text-neutral-400">
            {results.length} result{results.length === 1 ? "" : "s"} · local index, works offline ·
            ↑↓ to move, Enter to open
          </p>
        )}
      </div>
    </div>
  );
}
