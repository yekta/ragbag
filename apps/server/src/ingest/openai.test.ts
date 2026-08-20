import { describe, expect, it } from "vitest";
import { PermanentError } from "./errors.js";
import { describeAiError } from "./openai.js";

describe("describeAiError", () => {
  it("names the fix for the operator-fixable statuses", () => {
    expect(describeAiError({ status: 401 })).toContain("API key");
    expect(describeAiError({ status: 404 })).toContain("no such model");
    expect(describeAiError({ status: 429 })).toContain("quota");
    expect(describeAiError({ status: 500 })).toContain("HTTP 500");
  });

  it("passes our own failures through in the words they were raised in", () => {
    // A metering bug run through the HTTP branches reads as "couldn't reach
    // OpenAI", which sends an operator looking at the wrong thing entirely.
    expect(describeAiError(new PermanentError("the image could not be read"))).toBe(
      "the image could not be read",
    );
  });

  it("falls back to the error message for network-level failures", () => {
    expect(describeAiError(new Error("getaddrinfo ENOTFOUND api.openai.com"))).toContain(
      "ENOTFOUND",
    );
    expect(describeAiError("weird")).toContain("weird");
  });
});
