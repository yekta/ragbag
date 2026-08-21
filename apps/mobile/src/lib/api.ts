import Constants from "expo-constants";

// Where the API lives, from the phone's point of view.
//
// Unlike the web app, this can never be empty. The web app leaves its base URL
// blank in dev because Vite proxies /api and keeps everything same-origin;
// there is no proxy in front of a device, so every call here is cross-origin
// by construction and needs an absolute URL.
//
// Read from `extra` rather than from process.env directly, because Expo only
// reads a .env sitting next to the app, and this repo deliberately keeps one
// .env at its root for the server, the web app and this (app.config.ts lifts
// the two public values out of it).

type TExtra = { apiUrl?: string; zeroCacheUrl?: string; scheme?: string };

const extra = (Constants.expoConfig?.extra ?? {}) as TExtra;

export const API_BASE = extra.apiUrl ?? "http://localhost:3001";
export const ZERO_CACHE_URL = extra.zeroCacheUrl ?? "http://localhost:4848";
export const APP_SCHEME = extra.scheme ?? "ragbag";

/** Absolute URL for an API path (`/api/...`). */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
