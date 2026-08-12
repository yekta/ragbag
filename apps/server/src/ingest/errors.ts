// Failure semantics for the ingest pipeline (plan §7: failures are non-fatal
// and visible in the UI with a retry action).

/** Retry later without burning an attempt (e.g. blob bytes still uploading). */
export class WaitingError extends Error {}

/** Do not retry: the input itself can't be processed. */
export class PermanentError extends Error {}
