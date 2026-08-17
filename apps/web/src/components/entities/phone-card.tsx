import { CopyButton, EntityShell, ExternalAction, str, type EntityCardProps } from "./shell.js";

export function PhoneCard({ entity, onOpen }: EntityCardProps) {
  const data = entity.data as Record<string, unknown>;
  const number = str(data, "number") ?? entity.value;
  const name = str(data, "name");
  return (
    <EntityShell
      kind="phone"
      title={name ?? number}
      onOpen={onOpen}
      subtitle={name ? <span>{number}</span> : undefined}
      actions={
        <>
          <ExternalAction href={`tel:${number.replace(/[^\d+]/g, "")}`} icon="phone">
            Call
          </ExternalAction>
          <CopyButton value={number} />
        </>
      }
    />
  );
}
