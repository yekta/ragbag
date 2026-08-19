import { faceForMime } from "@ragbag/shared";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, type RefObject } from "react";
import { EmptyScreen } from "@/components/empty-screen";
import { EntityCard } from "@/components/entities";
import { TimelineEntities } from "@/components/entities/shell";
import { FACE_ICON, Icon } from "@/components/icon";
import { MediaImage } from "@/components/media-image";
import { useEntityTypes } from "@/lib/entity-types";
import { attachmentFaceOf, entityKindOf, entityLink, messageLink, useFilter } from "@/lib/routes";
import { dayLabel, formatBytes } from "@/lib/format";
import type { Attachment, Drop, EntityRows, Message } from "@/lib/types";

// The other half of the sidebar (plan §8.2). Chat-shaped rows filter the chat;
// thing-shaped rows replace it with a grid (images) or a list (everything
// else), newest first, each row linking back to the message it came from.
//
// Why not just filter the chat: filtering it to "messages containing an image"
// is strictly worse than showing the images. You lose density (one chat row
// per photo against a grid four across) and gain nothing, because the image
// *is* the content. Same for addresses: a list of places with map buttons is
// useful; a filtered chat where you hunt inside bubbles is not.

export function ThingsView({
  messages,
  entities,
  listRef,
}: {
  messages: Drop;
  entities: EntityRows;
  /** Owned by the shell, which watches it to know when the page has settled. */
  listRef: RefObject<HTMLDivElement | null>;
}) {
  const filter = useFilter();
  const face = attachmentFaceOf(filter.view);
  const kind = entityKindOf(filter.view, useEntityTypes());

  return (
    <div className="relative flex flex-1 flex-col px-3 pt-(--timeline-inset-top) pb-12 md:px-4">
      <div ref={listRef} className="mx-auto w-full max-w-3xl">
        {face ? (
          <AttachmentThings messages={messages} face={face} />
        ) : kind ? (
          <EntityThings entities={entities} kind={kind} />
        ) : null}
      </div>
    </div>
  );
}

type Found = { attachment: Attachment; message: Message };

/** Newest first, and "newest" is the message's time, not the file's position. */
function useAttachments(messages: Drop, face: string): Found[] {
  return useMemo(() => {
    const found: Found[] = [];
    for (const message of messages) {
      for (const attachment of message.attachments) {
        // `images` is the picture face; `files` is everything that is not one,
        // which is what makes the two rows cover every attachment between them.
        const mine =
          face === "image"
            ? faceForMime(attachment.mime) === "image"
            : faceForMime(attachment.mime) !== "image";
        if (mine) found.push({ attachment, message });
      }
    }
    return found;
  }, [messages, face]);
}

function AttachmentThings({ messages, face }: { messages: Drop; face: string }) {
  const filter = useFilter();
  const found = useAttachments(messages, face);

  if (found.length === 0) return <EmptyScreen />;

  if (face === "image") {
    return (
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        {found.map(({ attachment, message }) => (
          <Link
            key={attachment.id}
            {...messageLink(message.id, filter)}
            title={attachment.generatedTitle ?? attachment.filename}
            className="relative aspect-square overflow-hidden rounded-xl border"
          >
            <MediaImage
              blobId={attachment.blobId}
              variant="thumb"
              placeholder={attachment.placeholder}
              alt={attachment.generatedTitle ?? attachment.filename}
              fit="cover"
            />
          </Link>
        ))}
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {found.map(({ attachment, message }) => (
        <li key={attachment.id}>
          <Link
            {...messageLink(message.id, filter)}
            className="flex items-center gap-3 rounded-2xl border bg-background p-3.5 transition hover:bg-background-hover"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon name={FACE_ICON[faceForMime(attachment.mime)]} className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {attachment.generatedTitle ?? attachment.filename}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {/* Readings take the mono, the name it belongs to does not:
                    a filename is not a measurement, and mono would only make
                    the long ones truncate sooner. */}
                <span className="font-mono">{formatBytes(attachment.size)}</span> ·{" "}
                {attachment.filename}
              </span>
            </span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {dayLabel(message.createdAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EntityThings({ entities, kind }: { entities: EntityRows; kind: string }) {
  const filter = useFilter();
  const navigate = useNavigate();

  // Mentions to deleted messages are already excluded by the query, so an
  // entity with none left simply is not here: a deleted message cannot leave
  // a ghost address in the sidebar (plan §5.5).
  const rows = useMemo(
    () =>
      entities
        .filter((e) => e.kind === kind && e.mentions.length > 0)
        .toSorted((a, b) => b.updatedAt - a.updatedAt),
    [entities, kind],
  );

  if (rows.length === 0) return <EmptyScreen />;

  return (
    <TimelineEntities>
      <ul className="flex flex-col gap-1.5">
        {rows.map((entity) => (
          <li key={entity.id}>
            <EntityCard
              entity={entity}
              mentions={entity.mentions.length}
              onOpen={() => void navigate(entityLink(entity.id, filter))}
            />
          </li>
        ))}
      </ul>
    </TimelineEntities>
  );
}
