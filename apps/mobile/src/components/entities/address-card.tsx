import { addressQuery, mapsSearchUrl } from "@ragbag/shared";
import { Text } from "@/components/text";
import { CopyButton, EntityShell, ExternalAction, str, type TEntityCardProps } from "./shell";

// Addresses stay as they were written; the actions are what make them useful,
// and a maps *search* URL needs no API key and tolerates the half-remembered
// addresses people actually send.

export function AddressCard({ entity, onOpen }: TEntityCardProps) {
  const data = entity.data as Record<string, unknown>;
  const address = str(data, "formatted") ?? entity.value;
  const maps = mapsSearchUrl(address);
  return (
    <EntityShell
      kind="address"
      title={str(data, "name") ?? entity.generatedTitle ?? address}
      onOpen={onOpen}
      subtitle={<Text className="text-[13px] leading-snug text-muted-foreground">{address}</Text>}
      actions={
        <>
          {maps ? <ExternalAction href={maps}>Open in Maps</ExternalAction> : null}
          <CopyButton value={addressQuery(address)} />
        </>
      }
    />
  );
}
