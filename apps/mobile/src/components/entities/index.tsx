import type { ComponentType } from "react";
import { View } from "react-native";
import { Text } from "@/components/text";
import { useEntityTypes } from "@/features/session/entity-types";
import { AddressCard } from "./address-card";
import { DeclaredEntityCard } from "./declared-card";
import { EmailCard } from "./email-card";
import { InvoiceCard } from "./invoice-card";
import { LinkCard } from "./link-card";
import { PhoneCard } from "./phone-card";
import { CopyButton, EntityShell, MentionsContext, type TEntityCardProps } from "./shell";
import { TrackingCard } from "./tracking-card";

// Which card draws which kind. Six kinds have one of their own, because each
// has something of its own to offer: a preview image, a maps link, a carrier's
// tracking page, a mailto, a tel. This is the client's half of the behaviour
// lookup in @ragbag/shared, keyed by the same strings, and it applies to a
// user's `link` type however they renamed it. Every other kind shares
// `DeclaredEntityCard`, which draws that type's fields.

const CARDS: Record<string, ComponentType<TEntityCardProps>> = {
  link: LinkCard,
  address: AddressCard,
  tracking: TrackingCard,
  invoice: InvoiceCard,
  email: EmailCard,
  phone: PhoneCard,
};

/**
 * The last resort: a kind in no card map and in no synced type.
 *
 * That is a real state rather than a bug. A device holding a kind whose type
 * has since been disabled or renamed, or one that has not finished syncing the
 * type tables yet, still has the thing itself, and a chip with its value and a
 * copy button is more use than a blank.
 */
export function GenericEntityCard({ entity, onOpen }: TEntityCardProps) {
  const types = useEntityTypes();
  return (
    <EntityShell
      kind={entity.kind}
      title={entity.generatedTitle ?? entity.value}
      onOpen={onOpen}
      subtitle={
        <View className="self-start rounded-sm bg-muted px-1.5 py-0.5">
          <Text className="text-[11px]">{types.label(entity.kind)}</Text>
        </View>
      }
      actions={<CopyButton value={entity.value} />}
    />
  );
}

export function EntityCard({ mentions = 0, ...props }: TEntityCardProps) {
  const declared = useEntityTypes().get(props.entity.kind);
  const Card = CARDS[props.entity.kind] ?? (declared ? DeclaredEntityCard : GenericEntityCard);
  return (
    <MentionsContext value={mentions}>
      <Card {...props} />
    </MentionsContext>
  );
}

export { TimelineEntities } from "./shell";
