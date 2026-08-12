import { monotonicFactory } from "ulid";

// Item ids are client-generated ULIDs (required for offline create): sortable
// by creation time, collision-safe without coordination. Monotonic so a burst
// of dumps from one device keeps its order.
const next = monotonicFactory();

export function newId(): string {
  return next();
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: string): boolean {
  return ULID_RE.test(value);
}
