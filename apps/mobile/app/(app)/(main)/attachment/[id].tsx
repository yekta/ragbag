import { mutators, queries } from "@ragbag/contracts";
import { faceForMime } from "@ragbag/shared";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { AttachmentAlbum, formatDuration } from "@/components/attachment-album";
import { EntityCard } from "@/components/entities";
import { FACE_ICON, FACE_LABEL, Icon } from "@/components/icon";
import { messageEntities } from "@/components/message-card";
import { TagEditor } from "@/components/tag-editor";
import { Text } from "@/components/text";
import { AudioTranscript } from "@/features/detail/audio-transcript";
import { Section, SectionHeading, Seam } from "@/features/detail/section";
import { dayLabel, formatBytes, timeLabel } from "@/lib/format";
import { entityHref, messageHref } from "@/lib/routes";

// One file, and everything about it.
//
// It exists because this app already treats a file as one of the things it
// keeps and then had nowhere to put one. The sidebar lists Images and Files
// beside Links and IBANs, search gives a file its own row under Things, and
// the pipeline writes a title, a summary, tags and mentions against the file
// itself. Every one of those rows used to open the *message* the file arrived
// in, which is the one thing a reader who tapped a photo was not asking for.
//
// The same shape down the page as the other two sheets: what the thing is,
// then what was written about it, then what was found in it, then its tags. A
// reader who knows one of these sheets knows all three.
//
// What it does not have is a delete. A file is part of the message it was sent
// in ("exactly as it was sent"), so there is no mutator to remove one, and the
// way to get rid of a photo is to delete the message that carried it.

export default function AttachmentSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const zero = useZero();
  const router = useRouter();
  const [attachment] = useQuery(queries.attachment({ id }));
  const [allTags] = useQuery(queries.tags());

  if (!attachment) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text className="text-center text-muted-foreground">This file is gone.</Text>
      </View>
    );
  }

  const face = faceForMime(attachment.mime);
  const entities = messageEntities(attachment.mentions);
  const segments = face === "audio" ? attachment.content?.segments : null;

  return (
    <>
      {/* The face names the surface, not the filename: "Image", "PDF",
          "Audio", "File". The name of this particular file is data, and it is
          a row down in Details with the rest of what the file is. */}
      <Stack.Screen
        options={{
          title: FACE_LABEL[face],
          headerLeft: () => (
            <View className="flex-row items-center pl-1">
              <Icon name={FACE_ICON[face]} size={18} />
            </View>
          ),
        }}
      />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="p-5 pb-16"
        showsVerticalScrollIndicator={false}
      >
        {attachment.message ? (
          <Text className="mb-3 text-xs text-muted-foreground">
            Sent {dayLabel(attachment.message.createdAt)}
          </Text>
        ) : null}

        {/* The file itself, first and at the top, drawn by the album the
            timeline and the message sheet both use: a message has to read as
            the same message everywhere, and a file as the same file. */}
        <View className="mb-8 gap-2">
          <AttachmentAlbum attachments={[attachment]} variant="detail" />
          {attachment.status === "failed" ? (
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

        <Seam />

        {attachment.generatedTitle || attachment.generatedSummary ? (
          <View className="mb-8 rounded-xl bg-ai-soft p-3.5">
            <SectionHeading tone="text-ai">Summary</SectionHeading>
            {attachment.generatedTitle ? (
              <Text className="font-semibold leading-snug">{attachment.generatedTitle}</Text>
            ) : null}
            {attachment.generatedSummary ? (
              <Text
                className={`text-sm leading-relaxed ${attachment.generatedTitle ? "mt-1" : ""}`}
              >
                {attachment.generatedSummary}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* The same section the message sheet has, narrowed to what came out
            of *this* file: on a message these arrive mixed in with whatever
            its text and its other files said. */}
        {entities.length > 0 ? (
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
        ) : null}

        {/* A transcript is the one `content_md` worth rendering as something
            other than text: every line knows when it was said, so tapping one
            seeks there. This is also where a voice note is actually played,
            which is why the timeline's bubble does not try to be a transport. */}
        {segments && segments.length > 0 ? (
          <Section title="Transcript">
            <AudioTranscript blobId={attachment.blobId} segments={segments} />
          </Section>
        ) : null}

        {attachment.content?.contentMd ? (
          <Section title={`Content${attachment.content.truncated ? " (truncated)" : ""}`}>
            {/* The extracted text, as text. `content_md` is markdown by
                convention so a human can read it and the next model can too,
                but this view deliberately does not render it: an OCR pass that
                hallucinates a heading should look like a hallucinated line,
                not like a heading. */}
            <View className="max-h-96 rounded-xl border border-border bg-panel px-4 py-3">
              <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
                <Text className="font-mono text-[13px] leading-relaxed">
                  {attachment.content.contentMd}
                </Text>
              </ScrollView>
            </View>
          </Section>
        ) : null}

        <Section title="Details">
          <View className="gap-1">
            <Detail label="Filename">{attachment.filename}</Detail>
            <Detail label="Size" mono>
              {formatBytes(attachment.size)}
            </Detail>
            <Detail label="Type" mono>
              {attachment.mime}
            </Detail>
            {attachment.width != null && attachment.height != null ? (
              <Detail label="Dimensions" mono>
                {`${attachment.width} × ${attachment.height}`}
              </Detail>
            ) : null}
            {attachment.durationMs != null ? (
              <Detail label="Length" mono>
                {formatDuration(attachment.durationMs)}
              </Detail>
            ) : null}
            {attachment.message ? (
              <Detail label="Sent">
                {`${dayLabel(attachment.message.createdAt)} · ${timeLabel(attachment.message.createdAt)}`}
              </Detail>
            ) : null}
          </View>
        </Section>

        {/* Tags of the file's own, which is what `attachment_tags` has always
            held and what nothing in the app showed before this page. */}
        <Section title="Tags">
          <TagEditor
            userTagNames={attachment.tags
              .filter((t) => t.source === "user" && t.tag)
              .map((t) => t.tag!.name)}
            suggestions={allTags.filter((t) => t.kind === "topic").map((t) => t.name)}
            onSave={(names) =>
              void zero.mutate(
                mutators.tag.setForAttachment({ attachmentId: attachment.id, names }),
              )
            }
          />
          {attachment.tags.some((t) => t.source === "ai" && t.tag) ? (
            <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
              {attachment.tags
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

        {/* The thing sheet's last section, in the same place, worded the same
            way, because this is the same question: which messages is this
            thing in. The count is the literal 1 rather than a pluralised
            length: a file belongs to exactly one message, where a thing the
            pipeline found can be in any number of them. */}
        {attachment.message ? (
          <Section title="Seen in 1 message">
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(messageHref(attachment.messageId))}
              className="rounded-lg border border-border bg-panel p-3 active:bg-panel-hover"
            >
              <Text className="text-sm font-medium" numberOfLines={1}>
                {attachment.message.generatedTitle ??
                  attachment.message.text?.split("\n")[0] ??
                  "(no text)"}
              </Text>
              <Text className="mt-0.5 text-[11px] text-muted-foreground">
                {dayLabel(attachment.message.createdAt)} · {timeLabel(attachment.message.createdAt)}
              </Text>
            </Pressable>
          </Section>
        ) : null}
      </ScrollView>
    </>
  );
}

function Detail({
  label,
  mono = false,
  children,
}: {
  label: string;
  mono?: boolean;
  children: string;
}) {
  return (
    <View className="flex-row gap-4">
      <Text className="w-24 shrink-0 text-sm text-muted-foreground">{label}</Text>
      <Text className={`min-w-0 flex-1 text-sm ${mono ? "font-mono" : ""}`}>{children}</Text>
    </View>
  );
}
