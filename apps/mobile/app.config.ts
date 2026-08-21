import fs from "node:fs";
import path from "node:path";
import type { ExpoConfig } from "expo/config";

// One .env for the whole repo.
//
// Expo reads .env from the project root, which here is apps/mobile, but this
// repo keeps a single root .env (see .env.example) that the server and the web
// app both read. Rather than ask for a second copy that drifts, the two public
// values are lifted out of the root file here and handed to the app through
// `extra`. Only these two: everything else in that file is a secret, and
// anything reachable from `extra` ships inside the bundle.

const repoRoot = path.resolve(__dirname, "../..");

function loadRepoEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  // .env.local last, so a developer's own overrides win.
  for (const file of [".env", ".env.local"]) {
    const full = path.join(repoRoot, file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      out[match[1]!] = match[2]!.trim().replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

const repoEnv = { ...loadRepoEnv(), ...process.env };

/**
 * Where the API lives, from the phone's point of view.
 *
 * There is no dev proxy here. The web app can leave this empty because Vite
 * proxies /api and keeps everything same-origin; a phone talks to the API
 * directly, so in dev this has to be the machine's LAN address rather than
 * localhost, which on a device means the device.
 */
const apiUrl = repoEnv.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";
const zeroCacheUrl = repoEnv.EXPO_PUBLIC_ZERO_CACHE_URL ?? "http://localhost:4848";
// Google has two public client identifiers for native sign-in: the iOS client
// identifies this bundle, while the Web client is the audience Better Auth
// verifies on the server. Client IDs are public configuration, not secrets.
const googleIosClientId =
  repoEnv.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
  "254690380295-166e4hi7c41b7s1imlu4tqt5jmrejqbd.apps.googleusercontent.com";
const googleWebClientId =
  repoEnv.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
  repoEnv.GOOGLE_CLIENT_ID ||
  "254690380295-tuadi37tj2jpg9p6emurag2kfa5h1b96.apps.googleusercontent.com";
const googleIosUrlScheme = googleIosClientId.split(".").reverse().join(".");

/**
 * The custom scheme, which is load-bearing rather than cosmetic: better-auth
 * sends the OAuth round trip back to `<scheme>://`, and the server only
 * honours it if the same string is in `trustedOrigins` (apps/server/src/auth.ts
 * reads MOBILE_SCHEME for exactly this).
 */
const scheme = "ragbag";

const fontsFrom = (pkg: string, family: string, weights: readonly string[]) =>
  weights.map((weight) => `@expo-google-fonts/${pkg}/${weight}/${family}_${weight}.ttf`);

const config: ExpoConfig = {
  name: "Ragbag",
  slug: "ragbag",
  owner: "yektagg",
  scheme,
  version: "0.1.0",
  orientation: "default",
  // The archive is read as much as written, and both tablets get a real
  // sidebar column rather than a phone layout stretched sideways.
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "app.ragbag.mobile",
    supportsTablet: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "app.ragbag.mobile",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-sqlite",
    "expo-web-browser",
    ["@react-native-google-signin/google-signin", { iosUrlScheme: googleIosUrlScheme }],
    [
      "expo-font",
      {
        // Embedded at build time rather than fetched by useFonts at runtime:
        // a font that arrives after the first frame re-lays out every line of
        // the timeline underneath it.
        fonts: [
          ...fontsFrom("schibsted-grotesk", "SchibstedGrotesk", [
            "400Regular",
            "500Medium",
            "600SemiBold",
            "700Bold",
          ]),
          ...fontsFrom("spline-sans-mono", "SplineSansMono", ["400Regular"]),
        ],
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "Ragbag needs your photo library to attach pictures to a message.",
        cameraPermission: "Ragbag needs the camera to attach a photo to a message.",
      },
    ],
    ["expo-audio", { microphonePermission: "Ragbag needs the microphone to record a voice note." }],
    ["expo-splash-screen", { backgroundColor: "#fafafa", dark: { backgroundColor: "#0f0f0f" } }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl,
    zeroCacheUrl,
    scheme,
    googleIosClientId,
    googleWebClientId,
    // Committed, the way `eas init` would have written it into a static
    // app.json. It identifies the project on EAS and is not a secret; every
    // default Expo project carries its own in the repo. `eas init` cannot
    // write into a dynamic config, so it prints the id and stops, which is
    // what this line answers. EAS_PROJECT_ID overrides it, for a fork that
    // wants to build under its own account.
    eas: { projectId: repoEnv.EAS_PROJECT_ID ?? "9f98d032-4639-483f-93bd-37cd282967eb" },
  },
};

export default config;
