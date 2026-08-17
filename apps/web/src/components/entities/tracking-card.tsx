import { trackingUrl } from "@ragbag/shared";
import { CopyButton, EntityShell, ExternalAction, str, type EntityCardProps } from "./shell.js";

export function TrackingCard({ entity, onOpen }: EntityCardProps) {
  const data = entity.data as Record<string, unknown>;
  const number = str(data, "number") ?? entity.value;
  const carrier = str(data, "carrier");
  return (
    <EntityShell
      kind="tracking"
      title={number}
      onOpen={onOpen}
      subtitle={
        <span className="uppercase tracking-wide">
          {carrier ?? "carrier unknown"}
          {str(data, "status") ? ` · ${str(data, "status")}` : ""}
        </span>
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
