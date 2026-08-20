import { describe, expect, it } from "vitest";
import { EnvSchema } from "./env.js";

describe("EnvSchema", () => {
  it("applies dev defaults from an empty environment", () => {
    const cfg = EnvSchema.parse({});
    expect(cfg.PORT).toBe(3001);
    expect(cfg.NODE_ENV).toBe("development");
    expect(cfg.MIGRATE_ON_START).toBe(true);
    expect(cfg.DEV_LOGIN).toBe(false);
  });

  it("rejects production with the default secret or DEV_LOGIN", () => {
    expect(() => EnvSchema.parse({ NODE_ENV: "production" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() =>
      EnvSchema.parse({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "real-secret",
        DEV_LOGIN: "true",
      }),
    ).toThrow(/DEV_LOGIN/);
  });

  it("refuses to boot production without an OpenAI key, and accepts one", () => {
    const prod = { NODE_ENV: "production", BETTER_AUTH_SECRET: "real-secret" };
    expect(() => EnvSchema.parse(prod)).toThrow(/OPENAI_API_KEY/);
    expect(() => EnvSchema.parse({ ...prod, OPENAI_API_KEY: "sk-x" })).not.toThrow();
    // dev stays keyless-friendly
    expect(() => EnvSchema.parse({})).not.toThrow();
  });

  it("refuses to boot on a model that is not in the allow-list", () => {
    // A misspelled model 404s on every message and a model with no price
    // entry meters every call at $0.00, both of them quietly for the life of
    // the deploy. Failing validation is the only version anyone notices.
    expect(() => EnvSchema.parse({ AI_ENRICH_MODEL: "gpt-4o" })).toThrow();
    expect(() => EnvSchema.parse({ AI_ENRICH_MODEL: "gpt-5.6-lunar" })).toThrow();
    expect(() => EnvSchema.parse({ AI_TRANSCRIBE_MODEL: "whisper-1" })).toThrow();
    // The transcription model is not an enrichment model, and vice versa.
    expect(() => EnvSchema.parse({ AI_ENRICH_MODEL: "gpt-transcribe" })).toThrow();
    expect(() => EnvSchema.parse({ AI_TRANSCRIBE_MODEL: "gpt-5.6-luna" })).toThrow();
  });

  it("defaults to the cheap models and takes the step-ups", () => {
    const cfg = EnvSchema.parse({});
    expect(cfg.AI_ENRICH_MODEL).toBe("gpt-5.6-luna");
    expect(cfg.AI_TRANSCRIBE_MODEL).toBe("gpt-transcribe");
    expect(EnvSchema.parse({ AI_ENRICH_MODEL: "gpt-5.6-terra" }).AI_ENRICH_MODEL).toBe(
      "gpt-5.6-terra",
    );
    expect(EnvSchema.parse({ AI_ENRICH_MODEL: "gpt-5.6-sol" }).AI_ENRICH_MODEL).toBe("gpt-5.6-sol");
  });

  it("parses booleans from env strings", () => {
    expect(EnvSchema.parse({ DEV_LOGIN: "true" }).DEV_LOGIN).toBe(true);
    expect(EnvSchema.parse({ MIGRATE_ON_START: "false" }).MIGRATE_ON_START).toBe(false);
  });
});
