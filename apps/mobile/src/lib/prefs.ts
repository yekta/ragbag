import Storage from "expo-sqlite/kv-store";

// Device preferences: the theme, the sidebar's remembered state, the archive
// hint. Not data, so not Zero (plan §10), and deliberately the one exception
// to "view state never survives a reload".
//
// expo-sqlite's key-value store rather than AsyncStorage, for one property
// that matters more here than it looks: `getItemSync` is synchronous, exactly
// like the localStorage the web app reads these from. A theme that can only be
// read asynchronously is a theme the first frame paints without, which is a
// flash of the wrong one on every cold start.

export function readPref(key: string): string | null {
  try {
    return Storage.getItemSync(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    Storage.setItemSync(key, value);
  } catch {
    // Storage full or unavailable: the preference just will not survive a
    // relaunch. Nothing here is worth failing a render over.
  }
}

export function clearPref(key: string): void {
  try {
    Storage.removeItemSync(key);
  } catch {
    // ignore
  }
}
