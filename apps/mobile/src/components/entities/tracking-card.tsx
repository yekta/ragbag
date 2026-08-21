import { carrierName, trackingUrl } from "@ragbag/shared";
import { Text } from "@/components/text";
import { CopyButton, EntityShell, ExternalAction, str, type TEntityCardProps } from "./shell";

export function TrackingCard({ entity, onOpen }: TEntityCardProps) {
  const data = entity.data as Record<string, unknown>;
  const number = str(data, "number") ?? entity.value;
  const carrier = str(data, "carrier");
  const status = str(data, "status");
  return (
    <EntityShell
      kind="tracking"
      title={number}
      onOpen={onOpen}
      subtitle={
        <Text className="text-[13px] leading-snug text-muted-foreground">
          {carrier ? carrierName(carrier) : "Carrier unknown"}
          {status ? ` · ${status}` : ""}
        </Text>
      }
      actions={
        <>
          <ExternalAction href={trackingUrl(carrier ?? "", number)} icon="package">
            Track
          </ExternalAction>
          <CopyButton value={number} />
        </>
      }
    />
  );
}
