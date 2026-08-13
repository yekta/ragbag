import type { ItemKind } from "@ragbag/shared";
import { create } from "zustand";
import { applyTheme, loadTheme, THEME_KEY, type Theme } from "@/lib/theme";

// View-only state (plan §10): all *data* state lives in Zero. Filters narrow
// the locally-synced timeline; nothing here survives a reload on purpose —
// except `sidebarCollapsed` and `theme`, device preferences (like the
// remembered identity), which persist to localStorage.
//
// The mobile drawer's open state is deliberately *not* here: shadcn's
// SidebarProvider owns it and exposes it through `useSidebar()`.

// The rail's single-select view: one kind, the favorites collection, or
// everything. Favorites are a *view*, not a badge that hoists items to the top.
export type ViewFilter = ItemKind | "favorites" | null;

const COLLAPSE_KEY = "ragbag:sidebar-collapsed";

type ViewState = {
  viewFilter: ViewFilter;
  tagFilter: string | null; // tag id
  searchOpen: boolean;
  sidebarCollapsed: boolean; // desktop rail hidden (persisted)
  theme: Theme; // persisted
  setViewFilter: (view: ViewFilter) => void;
  setTagFilter: (tagId: string | null) => void;
  setSearchOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setTheme: (theme: Theme) => void;
  clearFilters: () => void;
};

const persistCollapsed = (collapsed: boolean) => {
  localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  return { sidebarCollapsed: collapsed };
};

export const useViewStore = create<ViewState>((set) => ({
  viewFilter: null,
  tagFilter: null,
  searchOpen: false,
  sidebarCollapsed: localStorage.getItem(COLLAPSE_KEY) === "1",
  theme: loadTheme(),
  // Picking a filter (or opening search) toggles it off when it was already
  // active; closing the mobile drawer is the caller's job (it needs the
  // SidebarProvider context).
  setViewFilter: (view) => set((s) => ({ viewFilter: s.viewFilter === view ? null : view })),
  setTagFilter: (tagId) => set((s) => ({ tagFilter: s.tagFilter === tagId ? null : tagId })),
  setSearchOpen: (open) => set({ searchOpen: open }),
  toggleSidebar: () => set((s) => persistCollapsed(!s.sidebarCollapsed)),
  setSidebarCollapsed: (collapsed) => set(persistCollapsed(collapsed)),
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },
  clearFilters: () => set({ viewFilter: null, tagFilter: null }),
}));
