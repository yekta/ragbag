import { v7 } from "uuid";

// Ids are client-generated UUID v7 (plan §3.2). v7 rather than v4 for the two
// properties that made ULID the v1 choice: minted on the device, so offline
// capture works without coordination, and time-sortable, so index locality and
// any id tiebreak survive. Being a plain UUID is what buys the pg `uuid`
// column type (Zero maps it to `string`, see plan §12).
//
// The generator keeps a per-process sequence counter, so a burst of messages
// inside one millisecond still comes out in order.

export function newId(): string {
  return v7();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
