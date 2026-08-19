import OpenAI from "openai";
import { env } from "../env.js";

// One client for vision, transcription, the scanned-PDF pass and synthesis
// (plan §5). Null when no key is configured: ingestion still runs (local
// extraction works, the AI stages are skipped), which production forbids
// (env.ts refuses to boot keyless) and dev/self-host at least announces (boot
// log, /api/meta, and the `error` note on the row itself).
export const openai: OpenAI | null = env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL })
  : null;

/**
 * An OpenAI failure, in words the detail view can show. AI failures are soft
 * (extraction survives, the reason lands in the row's `error` column), so the
 * reason has to say what an operator should actually fix.
 */
export function describeAiError(err: unknown): string {
  const status = (err as { status?: unknown } | null)?.status;
  // A 400 always names what it refused, and the note is the only place anyone
  // will see it: "OpenAI error (HTTP 400)" on its own is how a response_format
  // the transcription model does not accept sat there failing every recording
  // in the archive without saying so.
  if (status === 400) {
    const detail = apiMessage(err);
    return detail
      ? `OpenAI refused the request (400): ${detail}`
      : "OpenAI refused the request (400)";
  }
  if (status === 401) return "OpenAI rejected the API key (401)";
  if (status === 403) return "OpenAI refused access to the model (403)";
  if (status === 404) return "model not found (404), check AI_ENRICH_MODEL / AI_TRANSCRIBE_MODEL";
  if (status === 429) return "OpenAI rate limit or quota exceeded (429)";
  if (typeof status === "number") return `OpenAI error (HTTP ${status})`;
  const message = err instanceof Error ? err.message : String(err);
  return `couldn't reach OpenAI: ${message.slice(0, 200)}`;
}

/** The API's own words for a failure, off the SDK's error object. */
function apiMessage(err: unknown): string | null {
  const body = (err as { error?: { message?: unknown } } | null)?.error;
  const message =
    typeof body?.message === "string" ? body.message : err instanceof Error ? err.message : null;
  return message ? message.slice(0, 200) : null;
}
