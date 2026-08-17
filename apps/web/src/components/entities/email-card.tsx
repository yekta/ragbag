import { CopyButton, EntityShell, ExternalAction, str, type EntityCardProps } from "./shell.js";

export function EmailCard({ entity, onOpen }: EntityCardProps) {
  const data = entity.data as Record<string, unknown>;
  const address = str(data, "address") ?? entity.value;
  const name = str(data, "name");
  return (
    <EntityShell
      kind="email"
      title={name ?? address}
      onOpen={onOpen}
      subtitle={<span className="break-all">{name ? address : (str(data, "role") ?? "")}</span>}
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
