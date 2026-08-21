import { Text } from "@/components/text";
import { CopyButton, EntityShell, num, str, type TEntityCardProps } from "./shell";

export function InvoiceCard({ entity, onOpen }: TEntityCardProps) {
  const data = entity.data as Record<string, unknown>;
  const vendor = str(data, "vendor") ?? entity.generatedTitle ?? entity.value;
  const amount = num(data, "amount");
  const currency = str(data, "currency");
  const issuedAt = str(data, "issued_at");
  const number = str(data, "number");
  const line =
    [
      amount !== undefined ? `${amount.toFixed(2)}${currency ? ` ${currency}` : ""}` : null,
      issuedAt ? issuedAt.slice(0, 10) : null,
      number ? `#${number}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "No amount recorded";

  return (
    <EntityShell
      kind="invoice"
      title={vendor}
      onOpen={onOpen}
      subtitle={<Text className="text-[13px] leading-snug text-muted-foreground">{line}</Text>}
      actions={<CopyButton value={[vendor, number, amount].filter(Boolean).join(" ")} />}
    />
  );
}
