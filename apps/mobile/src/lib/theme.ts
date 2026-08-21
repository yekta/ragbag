import { useSyncExternalStore } from "react";
import { Uniwind } from "uniwind";
import { readPref, writePref } from "@/lib/prefs";

// Light, dark or the system's choice, exactly as on web, and stored the same
// way: a device preference, not data.
//
// The mechanism differs because the platform does. The web app toggles a class
// on <html> and lets CSS do the rest; uniwind holds the theme itself and
// re-resolves every className when it changes, so this module's whole job is
// to persist the choice and hand it to `Uniwind.setTheme`. "system" is not a
// third set of values, it is uniwind's adaptive mode following the OS.

export type TTheme = "light" | "dark" | "system";

const THEME_KEY = "ragbag.theme";

export function loadTheme(): TTheme {
  const stored = readPref(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

/**
 * Apply the stored theme. Called once at module load, before the first render,
 * so nothing paints in the wrong theme and then corrects itself.
 */
export function applyStoredTheme(): void {
  Uniwind.setTheme(loadTheme());
}

export function setTheme(theme: TTheme): void {
  writePref(THEME_KEY, theme);
  Uniwind.setTheme(theme);
  for (const listener of listeners) listener();
}

/** The choice as stored, which is what the settings screen shows as selected. */
export function useThemePreference(): TTheme {
  return useSyncExternalStore(subscribe, loadTheme, loadTheme);
}

/** What the theme actually resolved to, for the status bar and native chrome. */
export function useResolvedTheme(): "light" | "dark" {
  return useSyncExternalStore(subscribe, resolved, resolved);
}

function resolved(): "light" | "dark" {
  return Uniwind.currentTheme === "dark" ? "dark" : "light";
}

// uniwind has no public change event, so `setTheme` publishes its own. The
// OS-driven branch needs none: uniwind re-resolves every className when the
// system scheme flips, so anything reading a token re-renders anyway, and this
// exists so a settings row lights up the instant it is tapped rather than on
// the next unrelated render.
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
