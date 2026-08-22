import { mutators, queries } from "@ragbag/contracts";
import type { TDetailAttachment, TMessageDetail } from "@ragbag/client-runtime/rows";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { AttachmentAlbum, AttachmentThumb } from "@/components/attachment-album";
import { EntityCard } from "@/components/entities";
import { Icon } from "@/components/icon";
import { Linkified, messageEntities } from "@/components/message-card";
import { TagEditor } from "@/components/tag-editor";
import { Text } from "@/components/text";
import { Section, SectionHeading, Seam } from "@/features/detail/section";
import { attachmentHref, entityHref } from "@/lib/routes";
import { dayLabel, formatBytes, timeLabel } from "@/lib/format";
import { useMeta } from "@/lib/meta";
import { runMutation } from "@/lib/mutate";
import { toast } from "@/lib/toast";

// One message, open.
//
// A form sheet rather than the web's drawer, which is the platform's own
// version of the same idea: it opens over the chat, the chat stays mounted and
// scrolled behind it, and it is dismissed by dragging it down. All of the web
// panel's careful work to make a drawer open from a closed first frame belongs
// to Base UI's transition model and has no counterpart here: UIKit presents
// the sheet, so there is nothing to coax into animating.
//
// The order is the card's order, because this is the same message: what the
// person wrote, what they sent with it, when it was sent. Then a seam, and
// everything below it is what was read out of it.

export default function MessageSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const zero = useZero();
  const router = useRouter();
  const [message] = useQuery(queries.message({ id }));
  const [allTags] = useQuery(queries.tags());
  const meta = useMeta();
  const noteInk = useCSSVariable("--color-kind-note") as string;

  if (!message) {
    // The message is in the local store, so it is normally here on the first
    // frame. This is the deleted-while-open case, and the honest answer to it.
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text className="text-center text-muted-foreground">This message is gone.</Text>
      </View>
    );
  }

  const remove = () => {
    Alert.alert("Delete this message?", "Its attachments and everything found in it go with it.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        // Through runMutation, and the dismissal waits on it: Zero resolves a
        // failed mutation rather than rejecting it, so a bare `void mutate`
        // followed by a `back()` closes the sheet on a delete that did not
        // happen and leaves the message sitting in the chat behind it.
        onPress: () => {
          void runMutation(zero.mutate(mutators.message.delete({ id: message.id })))
            .then(() => router.back())
            .catch((err: unknown) =>
              toast.error(err instanceof Error ? err.message : "Could not delete this"),
            );
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Message",
          headerRight: () => (
            <View className="flex-row items-center gap-1">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={message.favorite ? "Remove from favorites" : "Add to favorites"}
                hitSlop={8}
                onPress={() =>
                  void zero.mutate(
                    mutators.message.setFavorite({ id: message.id, favorite: !message.favorite }),
                  )
                }
                className="size-11 items-center justify-center rounded-full active:bg-hover"
              >
                <Icon
                  name="star"
                  size={20}
                  filled={message.favorite}
                  color={message.favorite ? noteInk : undefined}
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete message"
                hitSlop={8}
                onPress={remove}
                className="size-11 items-center justify-center rounded-full active:bg-destructive-soft"
              >
                <Icon name="trash" size={20} />
              </Pressable>
            </View>
          ),
        }}
      />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="p-5 pb-16"
        showsVerticalScrollIndicator={false}
      >
        {/* The message, first, whatever it is made of: a paragraph, a photo, a
            voice note, all three, or one file and nothing else. No heading
            over it, because it is not a section of the page: it is the thing
            the page is about. */}
        <View className="mb-8 gap-2">
          {message.text ? <Linkified text={message.text} /> : null}
          <AttachmentAlbum attachments={message.attachments} variant="detail" />
          <View className="items-start gap-2">
            {/* The day the way the timeline says it, then the time the way the
                card says it: this is the same message, so the stamp under it
                open should be the words you would have read on it in the
                chat. */}
            <Text className="font-mono text-[11px] text-muted-foreground">
              {dayLabel(message.createdAt)} · {timeLabel(message.createdAt)}
            </Text>
          </View>
        </View>

        <Seam />

        {/* What the model wrote. The generated title lives here, with the rest
            of it, rather than as this sheet's title: it names what the message
            is about, which is a reading of the message, not the message. */}
        {message.generatedTitle || message.generatedSummary ? (
          <View className="mb-8 rounded-xl bg-ai-soft p-3.5">
            <SectionHeading tone="text-ai">Summary</SectionHeading>
            {message.generatedTitle ? (
              <Text className="font-semibold leading-snug">{message.generatedTitle}</Text>
            ) : null}
            {message.generatedSummary ? (
              <Text className={`text-sm leading-relaxed ${message.generatedTitle ? "mt-1" : ""}`}>
                {message.generatedSummary}
              </Text>
            ) : null}
          </View>
        ) : null}

        <ThingsFound mentions={message.mentions} />

        {/* Everything sent with the message, in the order it was sent, under
            one heading. Each file used to head its own section, which made a
            message with five photos read as five sections of the page rather
            than one list of five things. A filename is a row. */}
        {message.attachments.length > 0 ? (
          <Section title="Attachments">
            <View className="gap-1.5">
              {message.attachments.map((attachment) => (
                <AttachmentRow key={attachment.id} attachment={attachment} />
              ))}
            </View>
          </Section>
        ) : null}

        <Section title="Tags">
          <TagEditor
            userTagNames={message.tags
              .filter((t) => t.source === "user" && t.tag)
              .map((t) => t.tag!.name)}
            suggestions={allTags.filter((t) => t.kind === "topic").map((t) => t.name)}
            onSave={(names) =>
              void zero.mutate(mutators.tag.setForMessage({ messageId: message.id, names }))
            }
          />
          {message.tags.some((t) => t.source === "ai" && t.tag) ? (
            <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
              {message.tags
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

        <IngestState message={message} aiOn={meta?.ai} />
      </ScrollView>
    </>
  );
}

/**
 * The things this message mentions: exactly the set the card shows under its
 * tear, drawn with the same cards.
 */
function ThingsFound({ mentions }: { mentions: NonNullable<TMessageDetail>["mentions"] }) {
  const router = useRouter();
  const entities = messageEntities(mentions);
  if (entities.length === 0) return null;
  return (
    <Section title="Things found">
      <View className="gap-1.5">
        {entities.map((entity) => (
          <EntityCard
            key={entity.id}
            entity={entity}
            onOpen={() => router.push(entityHref(entity.id))}
          />
        ))}
      </View>
    </Section>
  );
}

/**
 * One attachment, as a row into its own page.
 *
 * The file itself is not here: it is up in the message, where it was sent.
 * Neither is what came out of it. A file is one of the things this app keeps
 * and has a page of its own, so the transcript, the extracted text and the
 * file's own tags live there, and this is the row that goes to them.
 */
function AttachmentRow({ attachment }: { attachment: TDetailAttachment }) {
  const zero = useZero();
  const router = useRouter();
  const failed = attachment.status === "failed";

  return (
    <View className="gap-2">
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(attachmentHref(attachment.id))}
        className="-mx-2 rounded-lg px-2 py-1.5 active:bg-panel-hover"
      >
        <View className="flex-row items-center gap-2">
          <AttachmentThumb attachment={attachment} />
          <Text className="min-w-0 flex-1 text-sm font-medium" numberOfLines={1}>
            {attachment.filename}
          </Text>
          <Text className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {formatBytes(attachment.size)}
          </Text>
        </View>
        {attachment.generatedSummary ? (
          <Text className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {attachment.generatedSummary}
          </Text>
        ) : null}
      </Pressable>

      {/* Outside the row, because a part that failed is a state of this
          message rather than something to go and read on another page. */}
      {failed ? (
        <View className="flex-row flex-wrap items-center gap-2 rounded-lg bg-destructive-soft px-3 py-2">
          <Icon name="alert" size={14} />
          <Text className="min-w-0 flex-1 text-xs text-destructive">
            {attachment.error ?? "This file couldn't be read"}
          </Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => void zero.mutate(mutators.attachment.retry({ id: attachment.id }))}
            className="h-8 flex-row items-center gap-1 rounded-md px-2 active:bg-destructive-soft-hover"
          >
            <Icon name="retry" size={12} />
            <Text className="text-xs text-destructive">Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {attachment.status === "done" && attachment.error ? (
        <View className="flex-row items-start gap-1.5">
          <Icon name="sparkles" size={12} />
          <Text className="flex-1 text-xs text-muted-foreground">{attachment.error}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Where ingestion got to, and what to do about it.
 *
 * Enrichment that finished with nothing to show is the case worth the words:
 * silence there read as a broken app for a full day (the server had no OpenAI
 * key), so absence explains itself and offers the re-run that already existed
 * for outright failures.
 */
function IngestState({
  message,
  aiOn,
}: {
  message: { id: string; status: string; error?: string | null; generatedSummary?: string | null };
  aiOn: boolean | undefined;
}) {
  const zero = useZero();
  const retry = () => void zero.mutate(mutators.message.retryIngest({ id: message.id }));

  if (message.status === "failed") {
    return (
      <View className="rounded-xl bg-destructive-soft p-3.5">
        <Text className="font-semibold text-destructive">Ingestion failed</Text>
        {message.error ? (
          <Text className="mt-1 text-sm text-destructive">{message.error}</Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={retry}
          className="mt-2 h-9 flex-row items-center gap-1.5 self-start rounded-md border border-destructive px-3 active:bg-destructive-soft-hover"
        >
          <Icon name="retry" size={14} />
          <Text className="text-sm text-destructive">Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (message.status === "pending" || message.status === "processing") {
    return (
      <View className="flex-row items-center gap-2">
        <Icon name="spinner" size={14} />
        <Text className="text-xs text-muted-foreground">
          {message.status === "processing" ? "Reading this message…" : "Queued for ingestion…"}
        </Text>
      </View>
    );
  }

  if ((message.status === "done" || message.status === "partial") && !message.generatedSummary) {
    return (
      <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
        <Icon name="sparkles" size={14} />
        <Text className="flex-1 text-xs text-muted-foreground">
          {message.error ??
            (aiOn === false
              ? "AI is off on this server, so there are no summaries, tags or entities."
              : "No summary for this message yet.")}
        </Text>
        {aiOn !== false ? (
          <Pressable
            accessibilityRole="button"
            onPress={retry}
            className="h-8 flex-row items-center gap-1 rounded-md border border-border px-2 active:bg-background-hover"
          >
            <Icon name="retry" size={12} />
            <Text className="text-xs">Run enrichment</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return null;
}
