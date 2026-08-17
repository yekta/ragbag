import { queries } from "@ragbag/contracts";
import { resolveEntityTypes, typeFromRows } from "@ragbag/shared";
import type { EntityTypeDef, EntityTypes } from "@ragbag/shared";
import { useQuery } from "@rocicorp/zero/react";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { rememberDeclaredSlugs } from "./thing-slugs.js";

// The kinds this user keeps: their `entity_types` rows, synced like any other
// row they own and compiled by the same function the ingestion worker uses. One
// compiler, so a card's labels, the prompt's field names and the validator
// cannot disagree.
//
// A context rather than a hook per call site, because the rail, every card, the
// Details list and the search index have to agree on one set.
//
// No loading state anywhere: the empty set is a correct answer while the query
// is landing, and a kind that is not in it yet renders through the generic card,
// which is the same thing that happens for a kind the user has since deleted.

const NO_TYPES = resolveEntityTypes([]);

const EntityTypesContext = createContext<EntityTypes>(NO_TYPES);

export function EntityTypesProvider({ children }: { children: ReactNode }) {
  const [rows] = useQuery(queries.entityTypes());

  const types = useMemo(() => {
    const declared: EntityTypeDef[] = [];
    for (const row of rows) {
      // Null for a row this build cannot compile (a field type from a newer
      // one). Skipping that type is the graceful answer: everything else in the
      // set still works.
      const def = typeFromRows(row, row.fields);
      if (def) declared.push(def);
    }
    return declared.length > 0 ? resolveEntityTypes(declared) : NO_TYPES;
  }, [rows]);

  // So the router still recognises /books as a view on the next cold load,
  // before there is a single synced row to ask (lib/thing-slugs.ts).
  useEffect(() => {
    rememberDeclaredSlugs(types.list.map((type) => type.slug));
  }, [types]);

  return <EntityTypesContext.Provider value={types}>{children}</EntityTypesContext.Provider>;
}

/** The set of kinds in effect: this user's types, as last synced. */
export function useEntityTypes(): EntityTypes {
  return useContext(EntityTypesContext);
}
