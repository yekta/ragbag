// Light/dark/system, applied by toggling `.dark` on <html> (the class the
// `dark` custom variant in index.css keys off).
//
// Like `sidebarCollapsed`, this is a *device* preference rather than data, so
// it lives in localStorage and not in Zero — a deliberate exception to "view
// state never survives a reload" (plan §10). index.html applies the stored
// value before first paint; everything here keeps it in sync afterwards.

export type Theme = "light" | "dark" | "system";

export const THEME_KEY = "ragbag:theme";

// Kept in step with --background in index.css, for the mobile browser chrome.
const THEME_COLOR = { light: "#f6fcf9", dark: "#0d1613" } as const;

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)");

export function loadTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return prefersDark().matches ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  const resolved = resolveTheme(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLOR[resolved]);
}

/** Re-applies on OS changes; only matters while the theme is "system". */
export function watchSystemTheme(onChange: () => void): () => void {
  const mq = prefersDark();
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
