import type { ItemKind } from "@ragbag/shared";
import { create } from "zustand";

// View-only state (plan §10): all *data* state lives in Zero. Filters narrow
// the locally-synced timeline; nothing here survives a reload on purpose —
// except `sidebarCollapsed`, a device preference (like the remembered
// identity), which persists to localStorage.

// The rail's single-select view: one kind, the favorites collection, or
// everything. Favorites are a *view*, not a badge that hoists items to the top.
export type ViewFilter = ItemKind | "favorites" | null;

const COLLAPSE_KEY = "ragbag:sidebar-collapsed";

type ViewState = {
  viewFilter: ViewFilter;
  tagFilter: string | null; // tag id
  searchOpen: boolean;
  sidebarCollapsed: boolean; // desktop rail hidden (persisted)
  sidebarOpen: boolean; // mobile drawer
  setViewFilter: (view: ViewFilter) => void;
  setTagFilter: (tagId: string | null) => void;
  setSearchOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  clearFilters: () => void;
};

export const useViewStore = create<ViewState>((set) => ({
  viewFilter: null,
  tagFilter: null,
  searchOpen: false,
  sidebarCollapsed: localStorage.getItem(COLLAPSE_KEY) === "1",
  sidebarOpen: false,
  // Picking a filter (or opening search) also closes the mobile drawer — on a
  // phone the drawer exists to pick one thing and get back to the timeline.
  setViewFilter: (view) =>
    set((s) => ({ viewFilter: s.viewFilter === view ? null : view, sidebarOpen: false })),
  setTagFilter: (tagId) =>
    set((s) => ({ tagFilter: s.tagFilter === tagId ? null : tagId, sidebarOpen: false })),
  setSearchOpen: (open) => set({ searchOpen: open, sidebarOpen: false }),
  toggleSidebar: () =>
    set((s) => {
      const collapsed = !s.sidebarCollapsed;
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
      return { sidebarCollapsed: collapsed };
    }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  clearFilters: () => set({ viewFilter: null, tagFilter: null, sidebarOpen: false }),
}));
