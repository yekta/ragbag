import { useState } from "react";
import { Icon } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Edits the user's own topic tags on one thing (full-replacement set). AI
// tags are not editable here; ingestion owns them and replaces them wholesale
// on every run.
//
// Three things are taggable now (messages, attachments, entities) through
// three join tables, so the caller passes the mutation rather than an id: the
// editor itself has nothing to say about which of the three it is editing.

export function TagEditor({
  userTagNames,
  suggestions,
  onSave,
}: {
  userTagNames: readonly string[];
  suggestions: readonly string[];
  onSave: (names: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const save = onSave;

  const add = (raw: string) => {
    const name = raw.trim().toLowerCase();
    if (!name) return;
    if (!userTagNames.includes(name)) save([...userTagNames, name]);
    setDraft("");
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {userTagNames.map((name) => (
        <Badge key={name} variant="secondary" className="py-0.5 pl-2.5 pr-1">
          {name}
          {/* The one button in the app that can't take the base's 44px hit
              area. This is 16px inside a chip in a wrapping row, so 44 would
              reach ~11px past the badge: five of those into the row above,
              over *its* remove button, and the row above loses because it
              paints first. 24px bleeds 4px against this row's 6px gap, so the
              hit areas tile the gap without ever crossing, which is the same
              arithmetic the sidebar's row strips use. */}
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-4 rounded-full text-muted-foreground before:min-h-6 before:min-w-6 hover:text-foreground"
            title={`Remove ${name}`}
            onClick={() => save(userTagNames.filter((n) => n !== name))}
          >
            <Icon name="x" className="size-3" />
          </Button>
        </Badge>
      ))}
      <span className="inline-flex items-center gap-1">
        <Icon name="plus" className="size-3 text-muted-foreground" />
        {/* Not a shadcn Input: this is an inline chip-row field, so it stays
            borderless and sized to the text. Bigger text than the chips it
            makes, though: at anything under 16px iOS Safari zooms the page in
            when you tap it (see components/ui/input.tsx), and `leading-5` is
            what keeps the taller text from growing the row. */}
        <input
          className="w-28 bg-transparent py-0.5 text-base leading-5 text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="add tag…"
          value={draft}
          list="tag-suggestions"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && userTagNames.length) {
              save(userTagNames.slice(0, -1));
            }
          }}
          onBlur={() => add(draft)}
        />
        <datalist id="tag-suggestions">
          {suggestions
            .filter((s) => !userTagNames.includes(s))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
      </span>
    </div>
  );
}
