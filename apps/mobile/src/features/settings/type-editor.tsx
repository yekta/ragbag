import type { TTypeRow } from "@ragbag/client-runtime/rows";
import { mutators, queries } from "@ragbag/contracts";
import { FIELD_TYPES, hasBehaviour, humanize, newId, slugFromLabel } from "@ragbag/shared";
import type { TFieldType } from "@ragbag/shared";
import { Host, Switch } from "@expo/ui";
import { MenuView } from "@react-native-menu/menu";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useRouter } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { Alert, Pressable, ScrollView, TextInput, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { Icon, TYPE_ICONS } from "@/components/icon";
import { Text } from "@/components/text";
import { runMutation } from "@/lib/mutate";
import { toast } from "@/lib/toast";

// One kind of thing, as a form: what it is called, what to look for, and the
// details ragbag should fill in when it finds one.
//
// Editing is safe by construction: the version trigger bumps, the next ingest
// under a newer version replaces `data` rather than merging into it, and a
// value whose field is gone still shows at the end of Details under a
// humanized label.
//
// The kinds ragbag understands itself (link, tracking, address, phone, email,
// invoice, iban) show their details read-only: the link fetcher writes
// `site_name` and friends directly, so a user deleting those fields would
// produce values with no labels. Everything a person *reads* is still theirs,
// which is what makes renaming "Phone Numbers" to "Telefon Numaraları" a user
// action rather than a release.
//
// Native where it counts: the switches are UISwitch and Material Switch
// through `@expo/ui`, and the field-type picker is a real UIMenu rather than a
// list of buttons. The text fields are `TextInput`, which is a UITextField and
// an EditText, so autocorrect, dictation and the system keyboard toolbar all
// work without this file knowing about any of them.

/** What one row of the field table holds while it is being edited. */
type TDraftField = {
  /** Local only: React keys, and what the move buttons reorder. */
  uid: string;
  name: string;
  label: string;
  type: TFieldType;
  values: string;
  required: boolean;
  description: string;
  /** In the dedupe key. Its rank is its place among the ticked rows. */
  key: boolean;
};

type TDraft = {
  label: string;
  sidebarTitle: string;
  slug: string;
  icon: string;
  hint: string;
  examples: string;
  titleTemplate: string;
  sidebar: boolean;
  fields: TDraftField[];
};

function emptyField(): TDraftField {
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

function draftFrom(type: TTypeRow | null): TDraft {
  if (!type) {
    return {
      label: "",
      sidebarTitle: "",
      slug: "",
      icon: "sparkles",
      hint: "",
      examples: "",
      titleTemplate: "",
      sidebar: true,
      fields: [emptyField()],
    };
  }
  return {
    label: type.label,
    sidebarTitle: type.sidebarTitle,
    slug: type.slug,
    icon: type.icon,
    hint: type.hint,
    examples: type.examples.join(", "),
    titleTemplate: type.titleTemplate ?? "",
    sidebar: type.sidebar,
    fields: [...type.fields]
      .toSorted((a, b) => a.position - b.position)
      .map((field) => ({
        uid: field.id,
        name: field.name,
        label: field.label,
        type: field.type as TFieldType,
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

/** The laziest plural that is right most of the time; it is editable anyway. */
function pluralize(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "";
  if (/[sx]$/i.test(trimmed)) return `${trimmed}es`;
  if (/[^aeiou]y$/i.test(trimmed)) return `${trimmed.slice(0, -1)}ies`;
  return `${trimmed}s`;
}

export function TypeEditor({ typeId }: { typeId: string | null }) {
  const [rows] = useQuery(queries.entityTypes());
  const type = typeId ? (rows.find((row) => row.id === typeId) ?? null) : null;
  // Keyed on the row so a late-arriving query fills the form once, and typing
  // into it is never interrupted by a re-sync of the same row.
  return <Form key={type?.id ?? "new"} type={type} />;
}

function Form({ type }: { type: TTypeRow | null }) {
  const zero = useZero();
  const router = useRouter();
  const [entities] = useQuery(queries.entities());
  const [draft, setDraft] = useState<TDraft>(() => draftFrom(type));
  const [saving, setSaving] = useState(false);
  // What deleting this type would take with it, counted from rows this device
  // already holds. Mentions to deleted messages are excluded by the query, so
  // this is what a person would actually see under the kind.
  const found = useMemo(
    () => (type ? entities.filter((e) => e.kind === type.kind && e.mentions.length > 0) : []),
    [entities, type],
  );
  // A kind ragbag understands itself. Its details are code's, not the user's,
  // so they are shown rather than offered.
  const owned = type ? hasBehaviour(type.kind) : false;

  const patch = (over: Partial<TDraft>) => setDraft((current) => ({ ...current, ...over }));
  const patchField = (uid: string, over: Partial<TDraftField>) =>
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
    const sidebarTitle = draft.sidebarTitle.trim() || label;
    if (!label || !draft.hint.trim()) {
      toast.error("Give it a name and say what to look for");
      return;
    }
    // A key field's rank is its place among the ticked ones, which is why the
    // table has a tick and a reorder rather than a number to get wrong.
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
        await runMutation(
          zero.mutate(
            mutators.entityType.create({
              id: newId(),
              label,
              sidebarTitle,
              slug: draft.slug.trim() || undefined,
              icon: draft.icon,
              hint: draft.hint.trim(),
              examples: commaList(draft.examples),
              titleTemplate: draft.titleTemplate.trim() || null,
              fields,
            }),
          ),
        );
      } else {
        await runMutation(
          zero.mutate(
            mutators.entityType.update({
              id: type.id,
              label,
              sidebarTitle,
              slug: draft.slug.trim() || slugFromLabel(sidebarTitle),
              icon: draft.icon,
              hint: draft.hint.trim(),
              examples: commaList(draft.examples),
              titleTemplate: draft.titleTemplate.trim() || null,
              sidebar: draft.sidebar,
            }),
          ),
        );
        // One submit, one mutation for the whole table: add, edit, remove and
        // reorder arrive together, or none of them do.
        if (!owned) {
          await runMutation(zero.mutate(mutators.entityType.setFields({ id: type.id, fields })));
        }
      }
      router.back();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save this");
    } finally {
      setSaving(false);
    }
  };

  // Deleting a type is two different intentions, and only one of them loses
  // anything (plan §9.2). Turning it off is a third, and it is the switch on
  // the settings list rather than a choice in here.
  //
  //   delete it            what it found stays, under a plain card, and stops
  //                        being something you can browse as a group
  //   delete it and them   the things go too
  //
  // The web asks you to type the type's name for the second one. That is a
  // keyboard-shaped confirmation and it reads as a chore on a phone, where the
  // field is under the sheet's own keyboard; the platform's answer to "this
  // one is serious" is a second alert with a destructive button, which is what
  // this does. The count is in both messages either way, because the consequence
  // is the thing worth stating, not the ritual.
  const runRemove = (deleteEntities: boolean) => {
    if (!type) return;
    void runMutation(zero.mutate(mutators.entityType.remove({ id: type.id, deleteEntities })))
      .then(() => {
        toast.info(`${type.sidebarTitle} deleted`);
        router.back();
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not delete this"),
      );
  };

  const remove = () => {
    if (!type) return;
    const count = found.length;
    if (count === 0) {
      Alert.alert(`Delete ${type.sidebarTitle}?`, "Nothing of this kind has been found yet.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => runRemove(false) },
      ]);
      return;
    }
    Alert.alert(
      `Delete ${type.sidebarTitle}?`,
      count === 1
        ? "You have one. Keep it, or delete it too."
        : `You have ${count}. Keep them, or delete them too.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: count === 1 ? "Keep it" : "Keep them",
          onPress: () => runRemove(false),
        },
        {
          text: count === 1 ? "Delete it too" : "Delete them too",
          style: "destructive",
          onPress: () =>
            Alert.alert(
              count === 1
                ? `Delete ${type.sidebarTitle} and the one thing found under it?`
                : `Delete ${type.sidebarTitle} and all ${count} things found under it?`,
              "They go from every device. The messages stay, and reading them again won't bring these back.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => runRemove(true) },
              ],
            ),
        },
      ],
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="p-5 pb-16 gap-5"
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-base font-semibold">
          {type ? type.sidebarTitle : "Something new to look for"}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: saving }}
          disabled={saving}
          onPress={() => void save()}
          className="h-10 justify-center rounded-lg bg-primary px-4 active:bg-primary-hover"
        >
          <Text className="text-sm font-semibold text-primary-foreground">
            {saving ? "Saving…" : "Save"}
          </Text>
        </Pressable>
      </View>

      <Field label="Name" hint="One of them: Book">
        <Input
          value={draft.label}
          placeholder="Book"
          onChangeText={(label) =>
            // Derived until it is touched: a new type gets its title and its
            // link for free, and either can be typed over.
            patch({
              label,
              ...(type
                ? {}
                : { sidebarTitle: pluralize(label), slug: slugFromLabel(pluralize(label)) }),
            })
          }
        />
      </Field>

      <Field label="Sidebar title" hint="All of them: Books">
        <Input
          value={draft.sidebarTitle}
          placeholder="Books"
          onChangeText={(next) =>
            patch({ sidebarTitle: next, ...(type ? {} : { slug: slugFromLabel(next) }) })
          }
        />
      </Field>

      <Field label="Link" hint={`ragbag.app/${draft.slug || "books"}`}>
        <Input
          value={draft.slug}
          placeholder="books"
          autoCapitalize="none"
          onChangeText={(slug) => patch({ slug })}
        />
      </Field>

      <Field label="Name each one by" hint="Which detail: {title}">
        <Input
          value={draft.titleTemplate}
          placeholder="{title}"
          autoCapitalize="none"
          onChangeText={(titleTemplate) => patch({ titleTemplate })}
        />
      </Field>

      <View>
        <Head label="Icon" />
        <View className="flex-row flex-wrap items-center gap-1.5">
          {TYPE_ICONS.map((name) => (
            <Pressable
              key={name}
              accessibilityRole="radio"
              accessibilityLabel={name}
              accessibilityState={{ selected: draft.icon === name }}
              onPress={() => patch({ icon: name })}
              // The selection is a ring on a box that is always the same size:
              // a selected state that swapped the fill for a bordered one
              // would move every icon after it along the row.
              className={`size-11 items-center justify-center rounded-md ${
                draft.icon === name ? "bg-secondary ring-1 ring-primary" : "active:bg-hover"
              }`}
            >
              <Icon name={name} size={18} />
            </Pressable>
          ))}
        </View>
        <View className="mt-3 flex-row items-center justify-between">
          <Text className="text-[13px] text-muted-foreground">Show in the sidebar</Text>
          <Host matchContents>
            <Switch
              value={draft.sidebar}
              onValueChange={(sidebar) => patch({ sidebar })}
              label="Show in the sidebar"
            />
          </Host>
        </View>
      </View>

      <Field label="What to look for">
        <Input
          value={draft.hint}
          placeholder="A book someone recommended, with its author."
          multiline
          onChangeText={(hint) => patch({ hint })}
        />
      </Field>

      <Field label="Examples" hint="Optional, comma separated">
        <Input
          value={draft.examples}
          placeholder="Dune, The Left Hand of Darkness"
          onChangeText={(examples) => patch({ examples })}
        />
      </Field>

      <View>
        <View className="mb-1 flex-row items-center justify-between">
          <Text className="text-xs font-semibold text-muted-foreground">Details</Text>
          {!owned ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => patch({ fields: [...draft.fields, emptyField()] })}
              className="h-8 flex-row items-center gap-1 rounded-md px-2 active:bg-hover"
            >
              <Icon name="plus" size={12} />
              <Text className="text-xs text-muted-foreground">Add</Text>
            </Pressable>
          ) : null}
        </View>
        <Text className="mb-3 text-[13px] text-muted-foreground">
          {owned
            ? "This one is built in, so its details are fixed."
            : "What to fill in for each one. Turn on the details that tell two apart."}
        </Text>
        <View className="gap-2">
          {draft.fields.map((field, index) => (
            <FieldRow
              key={field.uid}
              field={field}
              index={index}
              total={draft.fields.length}
              owned={owned}
              onPatch={(over) => patchField(field.uid, over)}
              onMove={(by) => move(index, by)}
              onRemove={() => patch({ fields: draft.fields.filter((f) => f.uid !== field.uid) })}
              typeExists={Boolean(type)}
            />
          ))}
        </View>
      </View>

      {type ? (
        <View className="border-t border-border pt-4">
          <Pressable
            accessibilityRole="button"
            onPress={remove}
            className="h-10 flex-row items-center gap-1.5 self-start rounded-lg px-3 active:bg-destructive-soft"
          >
            <Icon name="trash" size={14} />
            <Text className="text-sm text-destructive">Delete this type</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

function FieldRow({
  field,
  index,
  total,
  owned,
  typeExists,
  onPatch,
  onMove,
  onRemove,
}: {
  field: TDraftField;
  index: number;
  total: number;
  owned: boolean;
  typeExists: boolean;
  onPatch: (over: Partial<TDraftField>) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  return (
    <View className="rounded-lg border border-border p-2.5">
      <View className="flex-row items-center gap-2">
        {/* readOnly rather than disabled: a disabled input is drawn at half
            strength, which makes a fixed type's real details look like empty
            placeholders. */}
        <Input
          className="flex-1"
          value={field.label}
          readOnly={owned}
          placeholder="Author"
          onChangeText={(label) =>
            onPatch({
              label,
              // The name is the key this is stored under and the spelling the
              // model answers with. Derived while it is untouched, and left
              // alone once a field exists under it.
              ...(field.name && typeExists ? {} : { name: nameFromLabel(label) }),
            })
          }
        />
        {/* A real menu rather than a row of buttons or a wheel: eight choices
            is exactly what a UIMenu is for, and it names the current one on
            its face so the row reads without being opened. */}
        <MenuView
          title="Kind of detail"
          actions={FIELD_TYPES.map((name) => ({
            id: name,
            title: name,
            state: field.type === name ? "on" : "off",
          }))}
          onPressAction={({ nativeEvent }) => onPatch({ type: nativeEvent.event as TFieldType })}
          shouldOpenOnLongPress={false}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Kind of detail: ${field.type}`}
            accessibilityState={{ disabled: owned }}
            disabled={owned}
            className={`h-11 flex-row items-center gap-1 rounded-md border border-input px-2 ${
              owned ? "opacity-60" : "active:bg-background-hover"
            }`}
          >
            <Text className="text-base">{field.type}</Text>
            <Icon name="down" size={12} />
          </Pressable>
        </MenuView>
        {!owned ? (
          <View className="flex-row items-center">
            <RowButton
              icon="up"
              label="Move up"
              disabled={index === 0}
              onPress={() => onMove(-1)}
            />
            <RowButton
              icon="down"
              label="Move down"
              disabled={index === total - 1}
              onPress={() => onMove(1)}
            />
            <RowButton icon="trash" label="Remove" onPress={onRemove} />
          </View>
        ) : null}
      </View>

      {field.type === "enum" ? (
        <Input
          className="mt-2"
          value={field.values}
          readOnly={owned}
          placeholder="hardback, paperback, ebook"
          accessibilityLabel="Choices"
          onChangeText={(values) => onPatch({ values })}
        />
      ) : null}

      <Input
        className="mt-2"
        value={field.description}
        readOnly={owned}
        placeholder="What goes here. Optional"
        accessibilityLabel="What goes here"
        onChangeText={(description) => onPatch({ description })}
      />

      <View className="mt-2 gap-2">
        <View className="self-start rounded-sm bg-muted px-1 py-0.5">
          <Text className="font-mono text-[11px]">
            {field.name || nameFromLabel(field.label) || "field_name"}
          </Text>
        </View>
        <ToggleRow
          label="Always needed"
          value={field.required}
          disabled={owned}
          onValueChange={(required) => onPatch({ required })}
        />
        {/* Hidden for the kinds whose dedupe rule is code's: a switch here
            would be read by nothing (plan §10.3). */}
        {!owned ? (
          <ToggleRow
            label="Tells two apart"
            value={field.key}
            onValueChange={(key) => onPatch({ key })}
          />
        ) : null}
      </View>
    </View>
  );
}

function ToggleRow({
  label,
  value,
  disabled,
  onValueChange,
}: {
  label: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (next: boolean) => void;
}) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-[13px] text-muted-foreground">{label}</Text>
      <Host matchContents>
        <Switch value={value} onValueChange={onValueChange} label={label} disabled={disabled} />
      </Host>
    </View>
  );
}

function RowButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: "up" | "down" | "trash";
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      className={`size-9 items-center justify-center rounded-md ${
        disabled ? "opacity-40" : "active:bg-hover"
      }`}
      onPress={onPress}
    >
      <Icon name={icon} size={14} />
    </Pressable>
  );
}

function Head({ label, hint }: { label: string; hint?: string }) {
  return (
    <View className="mb-1 flex-row items-baseline gap-2">
      <Text className="text-sm font-medium">{label}</Text>
      {hint ? (
        <Text className="shrink text-xs text-muted-foreground" numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View>
      <Head label={label} hint={hint} />
      {children}
    </View>
  );
}

/** The app's field, at the one size every field in it is held to. */
function Input({
  className,
  ...props
}: React.ComponentProps<typeof TextInput> & { className?: string }) {
  const placeholderInk = useCSSVariable("--color-muted-foreground") as string;
  const ink = useCSSVariable("--color-foreground") as string;
  return (
    <TextInput
      placeholderTextColor={placeholderInk}
      // 16px, never less: under it the platform treats the field as something
      // to zoom into, which on a form this long means the page jumping on
      // every tap.
      className={`min-h-11 rounded-md border border-input px-2.5 py-2 text-base ${
        props.readOnly ? "border-transparent bg-muted" : ""
      } ${className ?? ""}`}
      style={{ color: ink }}
      {...props}
    />
  );
}
