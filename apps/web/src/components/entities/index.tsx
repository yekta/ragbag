import { entityLabel } from "@ragbag/shared";
import type { ComponentType } from "react";
import { AddressCard } from "./address-card.js";
import { EmailCard } from "./email-card.js";
import { InvoiceCard } from "./invoice-card.js";
import { LinkCard } from "./link-card.js";
import { PhoneCard } from "./phone-card.js";
import { CopyButton, EntityShell, str, type EntityCardProps } from "./shell.js";
import { TrackingCard } from "./tracking-card.js";

// The React side of the entity registry: a parallel map keyed by the same
// strings (plan §3.3). @ragbag/shared stays pure utilities with no React
// dependency, which is why this map lives here rather than on the definitions.

const CARDS: Record<string, ComponentType<EntityCardProps>> = {
  link: LinkCard,
  address: AddressCard,
  tracking: TrackingCard,
  invoice: InvoiceCard,
  email: EmailCard,
  phone: PhoneCard,
};

/**
 * The generic fallback: a labelled chip with its value and a copy button.
 *
 * This is what makes new kinds safe to ship to a fleet that updates at
 * different times, and what keeps a retired kind's data alive rather than
 * blank. An `other` entity renders through it by design; so does a kind from
 * a newer build this one has never heard of.
 */
export function GenericEntityCard({ entity, onOpen }: EntityCardProps) {
  const data = entity.data as Record<string, unknown>;
  const label = str(data, "label") ?? entityLabel(entity.kind);
  return (
    <EntityShell
      kind={entity.kind}
      title={entity.generatedTitle ?? entity.value}
      onOpen={onOpen}
      subtitle={
        <span>
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] uppercase tracking-wide">
            {label}
          </span>
          {str(data, "detail") ? ` ${str(data, "detail")}` : ""}
        </span>
      }
      actions={<CopyButton value={entity.value} />}
    />
  );
}

export function EntityCard(props: EntityCardProps) {
  const Card = CARDS[props.entity.kind] ?? GenericEntityCard;
  return <Card {...props} />;
}
