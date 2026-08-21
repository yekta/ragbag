import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { Icon } from "@/components/icon";
import { Text } from "@/components/text";

// Edits the user's own topic tags on one thing (a full-replacement set). AI
// tags are not editable here; ingestion owns them and replaces them wholesale
// on every run.
//
// Three things are taggable (messages, attachments, entities) through three
// join tables, so the caller passes the mutation rather than an id: the editor
// itself has nothing to say about which of the three it is editing.
//
// The suggestion list is a row of chips rather than the web's `<datalist>`,
// which has no native counterpart. It only shows what the draft is a prefix
// of, so it is a completion rather than a menu of everything.

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
  const placeholderInk = useCSSVariable("--color-muted-foreground") as string;
  const ink = useCSSVariable("--color-foreground") as string;

  const add = (raw: string) => {
    const name = raw.trim().toLowerCase();
    setDraft("");
    if (!name || userTagNames.includes(name)) return;
    onSave([...userTagNames, name]);
  };

  const matches = draft.trim()
    ? suggestions
        .filter((s) => !userTagNames.includes(s) && s.startsWith(draft.trim().toLowerCase()))
        .slice(0, 6)
    : [];

  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap items-center gap-1.5">
        {userTagNames.map((name) => (
          <View
            key={name}
            className="h-8 flex-row items-center gap-1 rounded-full bg-secondary pl-2.5 pr-1"
          >
            <Text className="text-sm text-secondary-foreground">{name}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${name}`}
              // A generous slop rather than a bigger chip: these wrap into
              // rows, and a target large enough to be comfortable would reach
              // into the row above and steal its remove button.
              hitSlop={8}
              onPress={() => onSave(userTagNames.filter((n) => n !== name))}
              className="size-6 items-center justify-center rounded-full active:bg-hover"
            >
              <Icon name="x" size={12} />
            </Pressable>
          </View>
        ))}
        <View className="h-8 flex-row items-center gap-1">
          <Icon name="plus" size={12} />
          <TextInput
            // 16px, like every field in this app: anything smaller and the
            // platform treats it as a form to zoom into.
            className="w-32 py-0.5 text-base"
            style={{ color: ink }}
            placeholder="add tag…"
            placeholderTextColor={placeholderInk}
            value={draft}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onChangeText={setDraft}
            onSubmitEditing={() => add(draft)}
            onBlur={() => add(draft)}
            onKeyPress={({ nativeEvent }) => {
              // Backspace on an empty field takes the last chip, which is what
              // every chip field does and what a thumb reaches for first.
              if (nativeEvent.key === "Backspace" && !draft && userTagNames.length > 0) {
                onSave(userTagNames.slice(0, -1));
              }
            }}
          />
        </View>
      </View>

      {matches.length > 0 ? (
        <View className="flex-row flex-wrap gap-1.5">
          {matches.map((name) => (
            <Pressable
              key={name}
              accessibilityRole="button"
              onPress={() => add(name)}
              className="h-8 justify-center rounded-full border border-border bg-card px-2.5 active:bg-background-hover"
            >
              <Text className="text-sm text-muted-foreground">{name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
