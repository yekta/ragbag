import { CopyButton, EntityShell, ExternalAction, str, type EntityCardProps } from "./shell.js";

// v1's LinkBody, now a card for a canonical entity: the same URL dumped in
// five messages is one of these, enriched and snapshotted once (plan §6.6).

export function LinkCard({ entity, onOpen }: EntityCardProps) {
  const data = entity.data as Record<string, unknown>;
  const url = str(data, "url") ?? entity.value;
  const host = hostOf(url);
  const favicon = str(data, "favicon_url");
  const image = str(data, "image_url");
  const description = str(data, "description") ?? entity.generatedSummary ?? undefined;

  return (
    <EntityShell
      kind="link"
      title={str(data, "title") ?? entity.generatedTitle ?? url}
      onOpen={onOpen}
      subtitle={
        <>
          <span className="flex items-center gap-1.5 text-[11px]">
            {favicon && <img src={favicon} alt="" className="size-3.5 rounded-xs" loading="lazy" />}
            <span className="truncate">{str(data, "site_name") ?? host ?? url}</span>
          </span>
          {description && <span className="mt-0.5 line-clamp-2 block">{description}</span>}
        </>
      }
      actions={
        <>
          <ExternalAction href={url}>Open</ExternalAction>
          <CopyButton value={url} label="Copy link" />
        </>
      }
      media={
        image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            className="hidden size-20 shrink-0 rounded-md object-cover sm:block"
          />
        ) : undefined
      }
    />
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
