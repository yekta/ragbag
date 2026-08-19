import type { ComponentType } from "react";
import { AddressCard } from "./address-card.js";
import { DeclaredEntityCard } from "./declared-card.js";
import { EmailCard } from "./email-card.js";
import { InvoiceCard } from "./invoice-card.js";
import { LinkCard } from "./link-card.js";
import { PhoneCard } from "./phone-card.js";
import { CopyButton, EntityShell, type EntityCardProps } from "./shell.js";
import { TrackingCard } from "./tracking-card.js";
import { useEntityTypes } from "@/lib/entity-types";

// Which card draws which kind. Six kinds have one of their own, because each
// has something of its own to offer: a preview image, a maps link, a carrier's
// tracking page, a mailto. This is the client's half of the behaviour lookup in
// @ragbag/shared, keyed by the same strings, and it applies to a user's `link`
// type however they renamed it. Every other kind shares `DeclaredEntityCard`,
// which draws that type's fields.

const CARDS: Record<string, ComponentType<EntityCardProps>> = {
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
export function GenericEntityCard({ entity, onOpen }: EntityCardProps) {
  const types = useEntityTypes();
  return (
    <EntityShell
      kind={entity.kind}
      title={entity.generatedTitle ?? entity.value}
      onOpen={onOpen}
      subtitle={
        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px]">
          {types.label(entity.kind)}
        </span>
      }
      actions={<CopyButton value={entity.value} />}
    />
  );
}

export function EntityCard(props: EntityCardProps) {
  const declared = useEntityTypes().get(props.entity.kind);
  const Card = CARDS[props.entity.kind] ?? (declared ? DeclaredEntityCard : GenericEntityCard);
  return <Card {...props} />;
}
