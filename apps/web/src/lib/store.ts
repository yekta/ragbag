import { create } from "zustand";
import { applyTheme, loadTheme, THEME_KEY, type TTheme } from "@/lib/theme";

// View-only state (plan §10): all *data* state lives in Zero. Nothing here
// survives a reload on purpose: except `sidebarCollapsed` and `theme`, device
// preferences (like the remembered identity), which persist to localStorage.
//
// The rail's filters are deliberately *not* here either, not any more: they are
// the URL (lib/routes.ts), because a view of the archive is the one thing in
// this app worth linking to.
//
// The mobile drawer's open state is deliberately *not* here: shadcn's
// SidebarProvider owns it and exposes it through `useSidebar()`.

const COLLAPSE_KEY = "ragbag:sidebar-collapsed";

type TViewState = {
  searchOpen: boolean;
  sidebarCollapsed: boolean; // desktop sidebar hidden (persisted)
  theme: TTheme; // persisted
  setSearchOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setTheme: (theme: TTheme) => void;
};

const persistCollapsed = (collapsed: boolean) => {
  localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  return { sidebarCollapsed: collapsed };
};

export const useViewStore = create<TViewState>((set) => ({
  searchOpen: false,
  sidebarCollapsed: localStorage.getItem(COLLAPSE_KEY) === "1",
  theme: loadTheme(),
  setSearchOpen: (open) => set({ searchOpen: open }),
  toggleSidebar: () => set((s) => persistCollapsed(!s.sidebarCollapsed)),
  setSidebarCollapsed: (collapsed) => set(persistCollapsed(collapsed)),
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },
}));
