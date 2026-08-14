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

  it("parses booleans from env strings", () => {
    expect(EnvSchema.parse({ DEV_LOGIN: "true" }).DEV_LOGIN).toBe(true);
    expect(EnvSchema.parse({ MIGRATE_ON_START: "false" }).MIGRATE_ON_START).toBe(false);
  });
});
