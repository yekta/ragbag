import { mutators } from "@ragbag/contracts";
import { FIELD_TYPES, hasBehaviour, humanize, newId, slugFromLabel } from "@ragbag/shared";
import type { FieldType } from "@ragbag/shared";
import { useZero } from "@rocicorp/zero/react";
import { useState } from "react";
import { toast } from "sonner";
import { Icon, TYPE_ICONS } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { TypeRow } from "@/lib/types";

// One kind of thing, as a form: what it is called, what the model is told to
// look for, and the fields it fills in.
//
// The fields are the shape of the thing, so they are also the shape of the
// prompt, the validator, the card and the Details list. Editing them is safe by
// construction: the version trigger bumps, the next ingest under a newer version
// replaces `data` rather than merging into it, and a value whose field is gone
// still shows at the end of Details under a humanized label.
//
// Behaviour-backed kinds (link, tracking, address, phone, email, invoice, iban)
// show their fields read-only. The link fetcher writes `site_name` and friends
// directly, so a user deleting those fields would produce values with no labels.
// Everything a person reads is still theirs to change, which is what makes
// renaming "Phone Numbers" to "Telefon Numaraları" a user action rather than a
// release.

/** What one row of the field table holds while it is being edited. */
type DraftField = {
  /** Local only: React keys, and what the move buttons reorder. */
  uid: string;
  name: string;
  label: string;
  type: FieldType;
  values: string;
  required: boolean;
  description: string;
  /** In the dedupe key. Its rank is its place among the checked rows. */
  key: boolean;
};

type Draft = {
  label: string;
  plural: string;
  slug: string;
  icon: string;
  hint: string;
  examples: string;
  titleTemplate: string;
  /** Whether it gets a row in the sidebar's Things section. */
  rail: boolean;
  fields: DraftField[];
};

/** What a field looks like when its type owns it: readable, not editable. */
const READ_ONLY = "border-transparent bg-muted";

function emptyField(): DraftField {
  return {
    uid: newId(),
    name: "",
    label: "",
    type: "text",
    values: "",
    required: false,
    description: "",
    key: false,
  };
}

function draftFrom(type: TypeRow | null): Draft {
  if (!type) {
    return {
      label: "",
      plural: "",
      slug: "",
      icon: "sparkles",
      hint: "",
      examples: "",
      titleTemplate: "",
      rail: true,
      fields: [emptyField()],
    };
  }
  return {
    label: type.label,
    plural: type.plural,
    slug: type.slug,
    icon: type.icon,
    hint: type.hint,
    examples: type.examples.join(", "),
    titleTemplate: type.titleTemplate ?? "",
    rail: type.rail,
    fields: [...type.fields]
      .toSorted((a, b) => a.position - b.position)
      .map((field) => ({
        uid: field.id,
        name: field.name,
        label: field.label,
        type: field.type as FieldType,
        values: (field.values ?? []).join(", "),
        required: field.required,
        description: field.description ?? "",
        key: field.keyRank !== undefined && field.keyRank !== null,
      })),
  };
}

/** "a, b , ,c" to ["a", "b", "c"]: the shape every list input here takes. */
function commaList(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** "Postal Code" to `postal_code`, for the name a field was not given. */
function nameFromLabel(label: string): string {
  return slugFromLabel(label).replace(/-/g, "_").slice(0, 40);
}

export function TypeEditor({
  type,
  onDone,
}: {
  /** Null when this is a new type: the same form, with nothing filled in. */
  type: TypeRow | null;
  onDone: () => void;
}) {
  const zero = useZero();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(type));
  const [saving, setSaving] = useState(false);
  // A kind this build understands itself. Its fields are code's, not the
  // user's, so they are shown rather than offered.
  const owned = type ? hasBehaviour(type.kind) : false;
  const patch = (over: Partial<Draft>) => setDraft((current) => ({ ...current, ...over }));

  const patchField = (uid: string, over: Partial<DraftField>) =>
    patch({
      fields: draft.fields.map((field) => (field.uid === uid ? { ...field, ...over } : field)),
    });

  const move = (index: number, by: number) => {
    const next = [...draft.fields];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    patch({ fields: next });
  };

  const save = async () => {
    const label = draft.label.trim();
    const plural = draft.plural.trim() || label;
    if (!label || !draft.hint.trim()) {
      toast.error("A type needs a name and a line telling the model what to look for");
      return;
    }
    // The rank is the row's place among the checked ones, which is why the
    // table has a checkbox and a reorder rather than a number to get wrong.
    let rank = 0;
    const fields = draft.fields
      .filter((field) => field.label.trim() || field.name.trim())
      .map((field) => ({
        name: field.name.trim() || nameFromLabel(field.label),
        label: field.label.trim() || humanize(field.name),
        type: field.type,
        values: field.type === "enum" ? commaList(field.values) : undefined,
        required: field.required,
        description: field.description.trim() || undefined,
        keyRank: field.key ? (rank += 1) : undefined,
      }));

    setSaving(true);
    try {
      if (!type) {
        await zero.mutate(
          mutators.entityType.create({
            id: newId(),
            label,
            plural,
            slug: draft.slug.trim() || undefined,
            icon: draft.icon,
            hint: draft.hint.trim(),
            examples: commaList(draft.examples),
            titleTemplate: draft.titleTemplate.trim() || null,
            fields,
          }),
        ).client;
      } else {
        await zero.mutate(
          mutators.entityType.update({
            id: type.id,
            label,
            plural,
            slug: draft.slug.trim() || slugFromLabel(plural),
            icon: draft.icon,
            hint: draft.hint.trim(),
            examples: commaList(draft.examples),
            titleTemplate: draft.titleTemplate.trim() || null,
            rail: draft.rail,
          }),
        ).client;
        // One submit, one mutation for the whole table: add, edit, remove and
        // reorder all arrive together, or none of them do.
        if (!owned) {
          await zero.mutate(mutators.entityType.setFields({ id: type.id, fields })).client;
        }
      }
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save this type");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" title="Back" onClick={onDone}>
          <Icon name="x" className="size-4" />
        </Button>
        <h3 className="text-sm font-medium">{type ? `Edit ${type.plural}` : "New type"}</h3>
        <Button
          className="ml-auto"
          size="sm"
          disabled={saving}
          onClick={() => {
            void save();
          }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label="Name" hint="One of them: Book">
          <Input
            value={draft.label}
            placeholder="Book"
            onChange={(e) => {
              const label = e.target.value;
              // Derived until it is touched: a new type gets its plural and its
              // URL for free, and either can be typed over. The URL comes off
              // the plural, because it lists them: /trading-cards, like every
              // slug in the catalog.
              patch({
                label,
                ...(type
                  ? {}
                  : { plural: pluralize(label), slug: slugFromLabel(pluralize(label)) }),
              });
            }}
          />
        </Labelled>
        <Labelled label="Plural" hint="The rail row: Books">
          <Input
            value={draft.plural}
            placeholder="Books"
            onChange={(e) => {
              const next = e.target.value;
              patch({ plural: next, ...(type ? {} : { slug: slugFromLabel(next) }) });
            }}
          />
        </Labelled>
        <Labelled label="URL" hint={`ragbag.app/${draft.slug || "books"}`}>
          <Input
            value={draft.slug}
            placeholder="books"
            onChange={(e) => patch({ slug: e.target.value })}
          />
        </Labelled>
        <Labelled label="Title" hint="Which field names one: {title}">
          <Input
            value={draft.titleTemplate}
            placeholder="{title}"
            onChange={(e) => patch({ titleTemplate: e.target.value })}
          />
        </Labelled>
      </div>

      <Grouped label="Icon" hint="Beside its row in the sidebar">
        <div className="flex flex-wrap items-center gap-1.5">
          {TYPE_ICONS.map((name) => (
            <Button
              key={name}
              variant={draft.icon === name ? "secondary" : "ghost"}
              size="icon-sm"
              title={name}
              className={draft.icon === name ? "ring-1 ring-primary" : "text-muted-foreground"}
              onClick={() => patch({ icon: name })}
            >
              <Icon name={name} className="size-4" />
            </Button>
          ))}
          {/* The row itself is optional: a kind worth extracting is not always a
              kind worth a permanent place in the rail. */}
          <label className="ml-auto flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Checkbox
              checked={draft.rail}
              onCheckedChange={(checked) => patch({ rail: checked === true })}
            />
            Show in the sidebar
          </label>
        </div>
      </Grouped>

      <Labelled label="What to look for" hint="The one line the model reads about this kind">
        <Textarea
          value={draft.hint}
          rows={2}
          placeholder="A book someone recommended or referred to, with its author."
          onChange={(e) => patch({ hint: e.target.value })}
        />
      </Labelled>

      <Labelled label="Examples" hint="A few real ones, comma separated. Optional">
        <Input
          value={draft.examples}
          placeholder="Dune, The Left Hand of Darkness"
          onChange={(e) => patch({ examples: e.target.value })}
        />
      </Labelled>

      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Fields
          </h4>
          {!owned && (
            <Button
              variant="ghost"
              size="xs"
              className="ml-auto text-muted-foreground"
              onClick={() => patch({ fields: [...draft.fields, emptyField()] })}
            >
              <Icon name="plus" className="size-3" /> Add a field
            </Button>
          )}
        </div>
        {owned ? (
          <p className="mb-2 rounded-md bg-muted px-2.5 py-2 text-[13px] text-muted-foreground">
            ragbag understands {draft.plural || "these"} itself: it finds them in your text, decides
            when two of them are the same one, and draws them its own way. Their fields come with
            that, so they are not editable. Everything above is yours.
          </p>
        ) : (
          <p className="mb-2 text-[13px] text-muted-foreground">
            What the model fills in. The key fields are what make two of them the same thing: tick
            them, and the arrows put them in order.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {draft.fields.map((field, index) => (
            <li key={field.uid} className="rounded-lg border bg-panel p-2.5">
              <div className="flex items-center gap-2">
                {/* readOnly rather than disabled on the three text inputs: a
                    disabled input is drawn at half strength, which made a
                    behaviour-backed type's real field names look like empty
                    placeholders. Read-only keeps them legible and selectable. */}
                <Input
                  className={`h-8 flex-1 ${owned ? READ_ONLY : ""}`}
                  value={field.label}
                  readOnly={owned}
                  placeholder="Author"
                  onChange={(e) => {
                    const label = e.target.value;
                    patchField(field.uid, {
                      label,
                      // The name is the jsonb key and the spelling the model
                      // answers with. Derived while it is untouched, and left
                      // alone once a field exists under it.
                      ...(field.name && type ? {} : { name: nameFromLabel(label) }),
                    });
                  }}
                />
                <select
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-50"
                  value={field.type}
                  disabled={owned}
                  aria-label="Field type"
                  onChange={(e) => patchField(field.uid, { type: e.target.value as FieldType })}
                >
                  {FIELD_TYPES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                {!owned && (
                  <span className="flex items-center">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground"
                      title="Move up"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <Icon name="up" className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground"
                      title="Move down"
                      disabled={index === draft.fields.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <Icon name="down" className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground"
                      title="Remove this field"
                      onClick={() =>
                        patch({ fields: draft.fields.filter((f) => f.uid !== field.uid) })
                      }
                    >
                      <Icon name="trash" className="size-3" />
                    </Button>
                  </span>
                )}
              </div>

              {field.type === "enum" && (
                <Input
                  className={`mt-2 h-8 ${owned ? READ_ONLY : ""}`}
                  value={field.values}
                  readOnly={owned}
                  placeholder="hardback, paperback, ebook"
                  aria-label="Values"
                  onChange={(e) => patchField(field.uid, { values: e.target.value })}
                />
              )}

              <Input
                className={`mt-2 h-8 ${owned ? READ_ONLY : ""}`}
                value={field.description}
                readOnly={owned}
                placeholder="What to put here, in one line for the model. Optional"
                aria-label="Description"
                onChange={(e) => patchField(field.uid, { description: e.target.value })}
              />

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                <code className="rounded-sm bg-muted px-1 py-0.5 text-[11px]">
                  {field.name || nameFromLabel(field.label) || "field_name"}
                </code>
                <label className="flex items-center gap-1.5">
                  <Checkbox
                    checked={field.required}
                    disabled={owned}
                    onCheckedChange={(checked) =>
                      patchField(field.uid, { required: checked === true })
                    }
                  />
                  Required
                </label>
                {/* Hidden for the kinds whose dedupe rule is code's: a key
                    ticked here would be read by nothing (plan §10.3). */}
                {!owned && (
                  <label className="flex items-center gap-1.5">
                    <Checkbox
                      checked={field.key}
                      onCheckedChange={(checked) =>
                        patchField(field.uid, { key: checked === true })
                      }
                    />
                    Part of the key
                  </label>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The laziest plural that is right most of the time; it is editable anyway. */
function pluralize(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "";
  if (/[sx]$/i.test(trimmed)) return `${trimmed}es`;
  if (/[^aeiou]y$/i.test(trimmed)) return `${trimmed.slice(0, -1)}ies`;
  return `${trimmed}s`;
}

function Head({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="mb-1 flex items-baseline gap-2">
      <span className="text-[13px] font-medium">{label}</span>
      {hint && <span className="truncate text-[11px] text-muted-foreground">{hint}</span>}
    </span>
  );
}

/** One field, one control: the caption is the control's own label. */
function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <Head label={label} hint={hint} />
      {children}
    </label>
  );
}

/**
 * The same caption over a group of controls rather than over one.
 *
 * Not a `<label>`: a label owns exactly one control, and the icon row holds
 * sixteen buttons and a checkbox with a label of its own. Nesting them made the
 * checkbox ambiguous to click and to read out.
 */
function Grouped({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Head label={label} hint={hint} />
      {children}
    </div>
  );
}
