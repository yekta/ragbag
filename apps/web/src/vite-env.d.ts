/// <reference types="vite/client" />

// Both are read at build time and baked into the bundle.
interface ImportMetaEnv {
  /** API origin, e.g. https://api.ragbag.app. Unset in dev — the Vite proxy fronts /api. */
  readonly VITE_API_URL?: string;
  /** zero-cache origin, e.g. https://zero.ragbag.app. */
  readonly VITE_ZERO_CACHE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
