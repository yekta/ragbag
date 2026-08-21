import { Image } from "expo-image";
import { View } from "react-native";
import { Text } from "@/components/text";
import { CopyButton, EntityShell, ExternalAction, str, type TEntityCardProps } from "./shell";

// The same URL sent in five messages is one of these, enriched and
// snapshotted once (plan §6.6).

export function LinkCard({ entity, onOpen }: TEntityCardProps) {
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
          <View className="flex-row items-center gap-1.5">
            {favicon ? (
              <Image
                source={{ uri: favicon }}
                style={{ width: 14, height: 14, borderRadius: 2 }}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            ) : null}
            <Text
              className="shrink text-[11px] leading-snug text-muted-foreground"
              numberOfLines={1}
            >
              {str(data, "site_name") ?? host ?? url}
            </Text>
          </View>
          {description ? (
            <Text
              className="mt-0.5 text-[13px] leading-snug text-muted-foreground"
              numberOfLines={2}
            >
              {description}
            </Text>
          ) : null}
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
          <Image
            source={{ uri: image }}
            style={{ width: 64, height: 64, borderRadius: 8 }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={120}
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
