// The Zero row shapes, which now live in @ragbag/client-runtime/rows so the
// mobile app reads exactly the same ones. Kept as a re-export because every
// component in this app imports `@/lib/types`, and a shared type is not worth
// touching forty files over.
export type * from "@ragbag/client-runtime/rows";
