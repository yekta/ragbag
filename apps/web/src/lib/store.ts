import type { ItemKind } from "@ragbag/shared";
import { create } from "zustand";

// View-only state (plan §10): all *data* state lives in Zero. Filters narrow
// the locally-synced timeline; nothing here survives a reload on purpose —
// except `sidebarCollapsed`, a device preference (like the remembered
// identity), which persists to localStorage.

export type KindFilter = ItemKind | "pinned" | null;

const COLLAPSE_KEY = "ragbag:sidebar-collapsed";

type ViewState = {
  kindFilter: KindFilter;
  tagFilter: string | null; // tag id
  searchOpen: boolean;
  sidebarCollapsed: boolean; // desktop rail hidden (persisted)
  sidebarOpen: boolean; // mobile drawer
  setKindFilter: (kind: KindFilter) => void;
  setTagFilter: (tagId: string | null) => void;
  setSearchOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  clearFilters: () => void;
};

export const useViewStore = create<ViewState>((set) => ({
  kindFilter: null,
  tagFilter: null,
  searchOpen: false,
  sidebarCollapsed: localStorage.getItem(COLLAPSE_KEY) === "1",
  sidebarOpen: false,
  // Picking a filter (or opening search) also closes the mobile drawer — on a
  // phone the drawer exists to pick one thing and get back to the timeline.
  setKindFilter: (kind) =>
    set((s) => ({ kindFilter: s.kindFilter === kind ? null : kind, sidebarOpen: false })),
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
  clearFilters: () => set({ kindFilter: null, tagFilter: null, sidebarOpen: false }),
}));
