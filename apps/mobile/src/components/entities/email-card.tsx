import { Text } from "@/components/text";
import { CopyButton, EntityShell, ExternalAction, str, type TEntityCardProps } from "./shell";

export function EmailCard({ entity, onOpen }: TEntityCardProps) {
  const data = entity.data as Record<string, unknown>;
  const address = str(data, "address") ?? entity.value;
  const name = str(data, "name");
  const second = name ? address : (str(data, "role") ?? "");
  return (
    <EntityShell
      kind="email"
      title={name ?? address}
      onOpen={onOpen}
      subtitle={
        second ? (
          <Text className="text-[13px] leading-snug text-muted-foreground">{second}</Text>
        ) : undefined
      }
      actions={
        <>
          <ExternalAction href={`mailto:${address}`} icon="mail">
            Compose
          </ExternalAction>
          <CopyButton value={address} />
        </>
      }
    />
  );
}
