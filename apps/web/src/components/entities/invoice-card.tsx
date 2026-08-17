import { CopyButton, EntityShell, num, str, type EntityCardProps } from "./shell.js";

export function InvoiceCard({ entity, onOpen }: EntityCardProps) {
  const data = entity.data as Record<string, unknown>;
  const vendor = str(data, "vendor") ?? entity.generatedTitle ?? entity.value;
  const amount = num(data, "amount");
  const currency = str(data, "currency");
  const issuedAt = str(data, "issued_at");
  const number = str(data, "number");
  return (
    <EntityShell
      kind="invoice"
      title={vendor}
      onOpen={onOpen}
      subtitle={
        <span>
          {[
            amount !== undefined ? `${amount.toFixed(2)}${currency ? ` ${currency}` : ""}` : null,
            issuedAt ? issuedAt.slice(0, 10) : null,
            number ? `#${number}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "no amount recorded"}
        </span>
      }
      actions={<CopyButton value={[vendor, number, amount].filter(Boolean).join(" ")} />}
    />
  );
}
