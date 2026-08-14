import { describe, expect, it } from "vitest";
import { describeAiError } from "./openai.js";

describe("describeAiError", () => {
  it("names the fix for the operator-fixable statuses", () => {
    expect(describeAiError({ status: 401 })).toContain("API key");
    expect(describeAiError({ status: 404 })).toContain("AI_ENRICH_MODEL");
    expect(describeAiError({ status: 429 })).toContain("quota");
    expect(describeAiError({ status: 500 })).toContain("HTTP 500");
  });

  it("falls back to the error message for network-level failures", () => {
    expect(describeAiError(new Error("getaddrinfo ENOTFOUND api.openai.com"))).toContain(
      "ENOTFOUND",
    );
    expect(describeAiError("weird")).toContain("weird");
  });
});
