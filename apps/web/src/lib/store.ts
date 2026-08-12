import type { ItemKind } from "@ragbag/shared";
import { create } from "zustand";

// View-only state (plan §10): all *data* state lives in Zero. Filters narrow
// the locally-synced timeline; nothing here survives a reload on purpose.

export type KindFilter = ItemKind | "pinned" | null;

type ViewState = {
  kindFilter: KindFilter;
  tagFilter: string | null; // tag id
  searchOpen: boolean;
  setKindFilter: (kind: KindFilter) => void;
  setTagFilter: (tagId: string | null) => void;
  setSearchOpen: (open: boolean) => void;
  clearFilters: () => void;
};

export const useViewStore = create<ViewState>((set) => ({
  kindFilter: null,
  tagFilter: null,
  searchOpen: false,
  setKindFilter: (kind) => set((s) => ({ kindFilter: s.kindFilter === kind ? null : kind })),
  setTagFilter: (tagId) => set((s) => ({ tagFilter: s.tagFilter === tagId ? null : tagId })),
  setSearchOpen: (open) => set({ searchOpen: open }),
  clearFilters: () => set({ kindFilter: null, tagFilter: null }),
}));
