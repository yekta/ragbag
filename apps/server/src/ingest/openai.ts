import OpenAI from "openai";
import { env } from "../env.js";

// One client for enrichment, vision, and embeddings (plan §7/§8). Null when
// no key is configured: ingestion still runs — extraction works, the AI
// stages are skipped — so dev and keyless self-hosts stay functional.
export const openai: OpenAI | null = env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL })
  : null;
