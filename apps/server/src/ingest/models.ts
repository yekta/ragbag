import { z } from "zod";

// Which OpenAI models this server is allowed to use, and what they cost.
//
// The lists are the contract: `env.ts` validates AI_ENRICH_MODEL and
// AI_TRANSCRIBE_MODEL against them, so a typo refuses to boot instead of
// booting fine and metering every call at $0.00 for the life of the deploy.
// Because the env is typed to these unions, `costUsd` is total: there is no
// unknown-model branch left to fall through, and `as const satisfies` makes
// adding a model without a price a compile error rather than a free row in
// the ledger.

export const AI_MODEL_LLM_AVAILABLE = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const;
export const AI_MODEL_AUDIO_TRANSCRIPTION_AVAILABLE = ["gpt-transcribe"] as const;

export const AI_MODEL_LLM_ENUM = z.enum(AI_MODEL_LLM_AVAILABLE);
export const AI_MODEL_AUDIO_TRANSCRIPTION_ENUM = z.enum(AI_MODEL_AUDIO_TRANSCRIPTION_AVAILABLE);

export type TAiModelLlm = z.infer<typeof AI_MODEL_LLM_ENUM>;
export type TAiModelAudioTranscription = z.infer<typeof AI_MODEL_AUDIO_TRANSCRIPTION_ENUM>;

/** Prices are quoted per this many tokens. */
export const TOKENS_PER_PRICE_UNIT = 1_000_000;
/** Audio prices are quoted per this many seconds. */
export const SECONDS_PER_PRICE_UNIT = 60;

/**
 * USD per 1,000,000 tokens.
 *
 * `cachedInput` is what a token read back out of the prompt cache costs, an
 * order of magnitude less than a fresh one; `cacheWrite` is a token written
 * into it, input at a 25% premium. The API reports all three separately, and
 * billing every input token at the fresh rate overstated cached work by 10x.
 */
type TTokenPriceUsdPerMillionTokens = {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
};

/**
 * USD per minute of audio. A different unit from the token table above, and
 * the field says so: a transcription model priced off tokens reports none, so
 * it lands in the ledger at exactly zero. That is the mistake this file's
 * shape exists to prevent.
 */
type TAudioPriceUsdPerMinute = { perMinute: number };

export const AI_MODEL_LLM_PRICES_USD = {
  "gpt-5.6-sol": { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 30 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 },
} as const satisfies Record<TAiModelLlm, TTokenPriceUsdPerMillionTokens>;

export const AI_MODEL_AUDIO_TRANSCRIPTION_PRICES_USD = {
  "gpt-transcribe": { perMinute: 0.0045 },
} as const satisfies Record<TAiModelAudioTranscription, TAudioPriceUsdPerMinute>;

/**
 * The response shape the configured transcription model can actually return.
 *
 * There is no format all of them take, and asking for the wrong one is a hard
 * 400 that loses the whole call ("response_format 'verbose_json' is not
 * compatible with model 'gpt-transcribe'"), which is how every recording came
 * back as `transcription failed` instead of words. Keyed off the enum rather
 * than sniffed out of the model name, so a model added above has to say which
 * format it speaks.
 */
export type TTranscriptionResponseFormat = "verbose_json" | "diarized_json" | "json";

export const AI_MODEL_AUDIO_TRANSCRIPTION_RESPONSE_FORMAT = {
  "gpt-transcribe": "json",
} as const satisfies Record<TAiModelAudioTranscription, TTranscriptionResponseFormat>;

/**
 * The diarizing models refuse a recording outright once it runs past 30
 * seconds without one ("chunking_strategy is required for diarization
 * models"), which is most of them; `auto` is their own voice-activity split.
 * Nothing else takes the parameter.
 *
 * Written as a function over the whole union rather than inline at the call
 * site, where the single-model table narrows the format to a literal and
 * turns the dormant branch into a type error.
 */
export function chunkingStrategyFor(
  format: TTranscriptionResponseFormat,
): { chunking_strategy: "auto" } | Record<string, never> {
  return format === "diarized_json" ? { chunking_strategy: "auto" } : {};
}
