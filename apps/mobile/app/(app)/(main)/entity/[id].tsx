import { mutators, queries } from "@ragbag/contracts";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { EntityCard } from "@/components/entities";
import { Icon, iconNamed } from "@/components/icon";
import { TagEditor } from "@/components/tag-editor";
import { Text } from "@/components/text";
import { Section, SectionHeading } from "@/features/detail/section";
import { useEntityTypes } from "@/features/session/entity-types";
import { dayLabel, timeLabel } from "@/lib/format";
import { runMutation } from "@/lib/mutate";
import { messageHref } from "@/lib/routes";
import { toast } from "@/lib/toast";

// One thing, and everything about it.
//
// This is the page that only exists because entities are canonical: without
// the entity/mention split there would be nothing that could answer
// "everything about this parcel", only N copies of it on N messages.

export default function EntitySheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const zero = useZero();
  const router = useRouter();
  const types = useEntityTypes();
  const [entity] = useQuery(queries.entity({ id }));
  const [allTags] = useQuery(queries.tags());

  if (!entity) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text className="text-center text-muted-foreground">This thing is gone.</Text>
      </View>
    );
  }

  const data = (entity.data ?? {}) as Record<string, unknown>;
  // The type's own fields, in the order it declares them, under the labels it
  // gives them: "Postal Code", not `postalCode` in whatever order the jsonb
  // happened to hold. A key the type no longer declares still shows, humanized,
  // at the end, so editing a type never blanks data that is already stored.
  const structured = types.fieldEntries(entity.kind, data);
  const label = types.label(entity.kind);

  const remove = () => {
    Alert.alert(
      `Delete this ${label}?`,
      "It disappears from all your devices, with its tags and everything found about it. The messages it was found in stay, and reading them again won't bring it back.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void runMutation(zero.mutate(mutators.entity.remove({ id: entity.id })))
              .then(() => router.back())
              .catch((err: unknown) =>
                toast.error(err instanceof Error ? err.message : "Could not delete this"),
              );
          },
        },
      ],
    );
  };

  return (
    <>
      {/* The header names the surface: the kind's own icon and the kind's own
          label, the pair the sidebar's row for it already uses. Not the
          thing's title, which is the first line of the card below and would
          otherwise be said twice. */}
      <Stack.Screen
        options={{
          title: label,
          headerLeft: () => (
            <View className="flex-row items-center pl-1">
              <Icon name={iconNamed(types.icon(entity.kind))} size={18} />
            </View>
          ),
        }}
      />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="p-5 pb-16"
        showsVerticalScrollIndicator={false}
      >
        <Text className="mb-3 text-xs text-muted-foreground">
          First seen {dayLabel(entity.firstSeenAt)}
        </Text>

        {/* The same card the chat draws, at the top of its own page. */}
        <View className="mb-8">
          <EntityCard entity={entity} />
        </View>

        {entity.generatedSummary ? (
          <View className="mb-8 rounded-xl bg-ai-soft p-3.5">
            <SectionHeading tone="text-ai">Summary</SectionHeading>
            <Text className="text-sm leading-relaxed">{entity.generatedSummary}</Text>
          </View>
        ) : null}

        {structured.length > 0 ? (
          <Section title="Details">
            <View className="gap-1">
              {structured.map((entry) => (
                <View key={entry.name} className="flex-row gap-4">
                  <Text className="w-28 shrink-0 text-sm text-muted-foreground">{entry.label}</Text>
                  <Text className="min-w-0 flex-1 text-sm">{entry.value}</Text>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        <Section title="Tags">
          <TagEditor
            userTagNames={entity.tags
              .filter((t) => t.source === "user" && t.tag)
              .map((t) => t.tag!.name)}
            suggestions={allTags.filter((t) => t.kind === "topic").map((t) => t.name)}
            onSave={(names) =>
              void zero.mutate(mutators.tag.setForEntity({ entityId: entity.id, names }))
            }
          />
          {entity.tags.some((t) => t.source === "ai" && t.tag) ? (
            <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
              {entity.tags
                .filter((t) => t.source === "ai" && t.tag)
                .map((t) => (
                  <View
                    key={t.tagId}
                    className="h-7 flex-row items-center gap-1 rounded-full bg-ai-soft px-2"
                  >
                    <Icon name="sparkles" size={12} />
                    <Text className="text-xs text-ai">{t.tag!.name}</Text>
                  </View>
                ))}
            </View>
          ) : null}
        </Section>

        <Section
          title={`Seen in ${entity.mentions.length} message${entity.mentions.length === 1 ? "" : "s"}`}
        >
          <View className="gap-1.5">
            {entity.mentions.map((mention) => (
              // The whole row goes to the message. It used to share the row
              // with a control that deleted the thing, which read as an action
              // on the message it sat on.
              <Pressable
                key={mention.id}
                accessibilityRole="button"
                onPress={() => router.push(messageHref(mention.messageId))}
                className="rounded-lg border border-border bg-panel p-3 active:bg-panel-hover"
              >
                <Text className="text-sm font-medium" numberOfLines={1}>
                  {mention.message?.generatedTitle ??
                    mention.message?.text?.split("\n")[0] ??
                    "(no text)"}
                </Text>
                {mention.snippet ? (
                  <Text className="mt-0.5 text-[13px] text-muted-foreground" numberOfLines={2}>
                    {mention.snippet}
                  </Text>
                ) : null}
                <Text className="mt-0.5 text-[11px] text-muted-foreground">
                  {mention.message ? dayLabel(mention.message.createdAt) : ""}
                  {mention.message ? ` · ${timeLabel(mention.message.createdAt)}` : ""}
                  {mention.attachment ? ` · found in ${mention.attachment.filename}` : ""}
                  {mention.source === "regex" ? " · pattern match" : ""}
                </Text>
              </Pressable>
            ))}
          </View>
        </Section>

        {/* Its own section, because deleting the thing is about the thing. The
            sentence says what survives it: the messages. */}
        <Section title="Delete">
          <Text className="text-[13px] text-muted-foreground">
            Deletes this {label} everywhere.{" "}
            {entity.mentions.length === 1
              ? "The message it was found in stays."
              : "The messages it was found in stay."}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={remove}
            className="mt-2 h-10 flex-row items-center gap-1.5 self-start rounded-lg bg-destructive px-3 active:bg-destructive-hover"
          >
            <Icon name="trash" size={14} />
            <Text className="text-sm font-semibold text-primary-foreground">Delete</Text>
          </Pressable>
        </Section>
      </ScrollView>
    </>
  );
}
