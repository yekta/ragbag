import { View } from "react-native";
import { Text } from "@/components/text";
import { useEntityTypes } from "@/features/session/entity-types";
import { CopyButton, EntityShell, type TEntityCardProps } from "./shell";

// The card for a kind the user declared. One component for all of them,
// because a declared type has no behaviour of its own: what it has is fields,
// and this draws them.
//
// Field order and labels come from `entity_type_fields`, so "Brand Name" and
// "Postal Code" are the type's copy rather than a jsonb key with its
// underscores showing. The key field leads (it is the title, via the type's
// title template), and the rest read as a compact definition list.

/** How many fields fit on a card before the entity's own page is the place. */
const MAX_ROWS = 4;

export function DeclaredEntityCard({ entity, onOpen }: TEntityCardProps) {
  const types = useEntityTypes();
  const data = entity.data as Record<string, unknown>;
  const entries = types.fieldEntries(entity.kind, data);
  const title = entity.generatedTitle ?? types.title(entity.kind, entity.value, data);
  // Whatever the title already says does not need saying twice underneath it.
  const rows = entries.filter((entry) => entry.value !== title).slice(0, MAX_ROWS);

  return (
    <EntityShell
      kind={entity.kind}
      title={title}
      onOpen={onOpen}
      subtitle={
        <>
          <View className="self-start rounded-sm bg-muted px-1.5 py-0.5">
            <Text className="text-[11px]">{types.label(entity.kind)}</Text>
          </View>
          {rows.length > 0 ? (
            <View className="mt-1 gap-0.5">
              {rows.map((entry) => (
                // A row rather than a two-column grid: React Native has no
                // `grid`, and a label column sized to its widest member would
                // need a measuring pass. The label takes what it needs and the
                // value takes the rest, which on a phone's width reads the
                // same and never has a column of empty space in it.
                <View key={entry.name} className="flex-row gap-2.5">
                  <Text className="shrink-0 text-[13px] text-muted-foreground">{entry.label}</Text>
                  <Text className="min-w-0 flex-1 text-[13px]" numberOfLines={1}>
                    {entry.value}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      }
      actions={<CopyButton value={entity.value} />}
    />
  );
}
