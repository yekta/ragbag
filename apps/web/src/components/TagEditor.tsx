import { mutators } from "@ragbag/contracts";
import { useZero } from "@rocicorp/zero/react";
import { useState } from "react";
import { Icon } from "./Icon.js";

// Edits the user's own topic tags on an item (full-replacement set — the
// tag.setForItem mutator). AI tags are not editable here; ingestion owns them.

export function TagEditor({
  itemId,
  userTagNames,
  suggestions,
}: {
  itemId: string;
  userTagNames: readonly string[];
  suggestions: readonly string[];
}) {
  const zero = useZero();
  const [draft, setDraft] = useState("");

  const save = (names: string[]) => {
    void zero.mutate(mutators.tag.setForItem({ itemId, names }));
  };

  const add = (raw: string) => {
    const name = raw.trim().toLowerCase();
    if (!name) return;
    if (!userTagNames.includes(name)) save([...userTagNames, name]);
    setDraft("");
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {userTagNames.map((name) => (
        <span
          key={name}
          className="inline-flex items-center gap-1 rounded-full bg-neutral-100 py-0.5 pl-2.5 pr-1 text-xs text-neutral-700"
        >
          {name}
          <button
            className="rounded-full p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
            title={`Remove ${name}`}
            onClick={() => save(userTagNames.filter((n) => n !== name))}
          >
            <Icon name="x" className="size-3" />
          </button>
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <Icon name="plus" className="size-3 text-neutral-400" />
        <input
          className="w-28 bg-transparent py-0.5 text-xs text-neutral-700 placeholder-neutral-400 outline-none"
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
