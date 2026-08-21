import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { describe, expect, it } from "vitest";
import { nativeOAuthBody, nativeOAuthHook } from "./mobile-oauth.js";

describe("nativeOAuthBody", () => {
  it("pins every OAuth return URL for the native client", () => {
    expect(
      nativeOAuthBody(
        "/sign-in/social",
        "ragbag:///",
        {
          provider: "google",
          callbackURL: "https://app.ragbag.app/",
          errorCallbackURL: "https://app.ragbag.app/error",
        },
        "ragbag",
      ),
    ).toEqual({
      provider: "google",
      callbackURL: "ragbag:///",
      newUserCallbackURL: "ragbag:///",
      errorCallbackURL: "ragbag:///sign-in",
    });
  });

  it("does not alter web sign-ins", () => {
    expect(
      nativeOAuthBody(
        "/sign-in/social",
        null,
        { provider: "google", callbackURL: "https://app.ragbag.app/" },
        "ragbag",
      ),
    ).toBeUndefined();
  });

  it("does not trust a different custom scheme", () => {
    expect(
      nativeOAuthBody(
        "/sign-in/social",
        "attacker:///",
        { provider: "google", callbackURL: "https://app.ragbag.app/" },
        "ragbag",
      ),
    ).toBeUndefined();
  });

  it("stores the native return URL in real OAuth state", async () => {
    const storage = new Map<string, string>();
    const testAuth = betterAuth({
      baseURL: "https://api.ragbag.test",
      secret: "test-secret-with-at-least-thirty-two-characters",
      trustedOrigins: ["https://app.ragbag.test", "ragbag://"],
      secondaryStorage: {
        get: (key) => storage.get(key),
        getAndDelete: (key) => {
          const value = storage.get(key);
          storage.delete(key);
          return value;
        },
        increment: (key) => {
          const value = Number(storage.get(key) ?? "0") + 1;
          storage.set(key, String(value));
          return value;
        },
        set: (key, value) => void storage.set(key, value),
        delete: (key) => void storage.delete(key),
      },
      hooks: { before: nativeOAuthHook("ragbag") },
      socialProviders: {
        google: { clientId: "test-client", clientSecret: "test-secret" },
      },
      plugins: [expo()],
    });

    // Deliberately submit the exact bad value seen on the phone. The mobile
    // header must win before Better Auth signs the OAuth state.
    const signIn = await testAuth.handler(
      new Request("https://api.ragbag.test/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json", "expo-origin": "ragbag:///" },
        body: JSON.stringify({
          provider: "google",
          callbackURL: "https://app.ragbag.test/",
          errorCallbackURL: "https://app.ragbag.test/error",
        }),
      }),
    );
    expect(signIn.status).toBe(200);
    const { url: authorizationURL } = (await signIn.json()) as { url: string };
    const state = new URL(authorizationURL).searchParams.get("state");
    expect(state).toBeTruthy();

    // Mirror the Expo client's proxy hop. It moves the OAuth state into the
    // browser session so the callback can validate it without a native cookie
    // jar. `access_denied` exercises the redirect without calling Google.
    const proxy = await testAuth.handler(
      new Request(
        `https://api.ragbag.test/api/auth/expo-authorization-proxy?authorizationURL=${encodeURIComponent(authorizationURL)}`,
      ),
    );
    expect(proxy.status).toBe(302);
    const setCookie = proxy.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("better-auth.state=");

    const callback = await testAuth.handler(
      new Request(
        `https://api.ragbag.test/api/auth/callback/google?error=access_denied&state=${encodeURIComponent(state!)}`,
        { headers: { cookie: setCookie!.split(";", 1)[0]! } },
      ),
    );
    expect(callback.status).toBe(302);
    const location = new URL(callback.headers.get("location")!);
    expect(`${location.protocol}//${location.pathname}`).toBe("ragbag:///sign-in");
    expect(location.searchParams.get("error")).toBe("access_denied");
  });
});
