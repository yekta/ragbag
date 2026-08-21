import { Text } from "@/components/text";
import { CopyButton, EntityShell, ExternalAction, str, type TEntityCardProps } from "./shell";

export function PhoneCard({ entity, onOpen }: TEntityCardProps) {
  const data = entity.data as Record<string, unknown>;
  const number = str(data, "number") ?? entity.value;
  const name = str(data, "name");
  return (
    <EntityShell
      kind="phone"
      title={name ?? number}
      onOpen={onOpen}
      subtitle={
        name ? (
          <Text className="text-[13px] leading-snug text-muted-foreground">{number}</Text>
        ) : undefined
      }
      actions={
        <>
          {/* A phone can actually place this call, which is the one entity
              action that is better here than on the web by a wide margin. */}
          <ExternalAction href={`tel:${number.replace(/[^\d+]/g, "")}`} icon="phone">
            Call
          </ExternalAction>
          <CopyButton value={number} />
        </>
      }
    />
  );
}
