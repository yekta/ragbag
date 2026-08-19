import {
  STARTER_SET,
  fieldRowsFor,
  log,
  newId,
  resolveEntityTypes,
  typeFromRows,
  typeRowFor,
} from "@ragbag/shared";
import type { EntityTypeDef, EntityTypes } from "@ragbag/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "./db/client.js";
import { entityTypeFields, entityTypes, user } from "./db/schema.js";

// One user's entity types: what they are seeded with, and what a job reads.
//
// Every type is a row, including the kinds this build understands itself: a
// user cannot delete something that only exists in code, so `link` and friends
// are seeded from the catalog like everything else and the behaviour attaches
// by kind name while the rows compile (@ragbag/shared).

/**
 * The kinds one ingestion job may extract: this user's enabled types, compiled
 * from their fields.
 *
 * Read fresh per job, deliberately. There is no process cache, so nothing has
 * to be invalidated: a type added in settings applies to the next job, and two
 * jobs running while a type changes each hold their own consistent view rather
 * than half-applying one. That is what "the set is fixed for a given job" means,
 * and it costs two indexed selects beside a model call a thousand times more
 * expensive.
 */
export async function loadEntityTypes(userId: string): Promise<EntityTypes> {
  const rows = await db
    .select()
    .from(entityTypes)
    .where(and(eq(entityTypes.userId, userId), eq(entityTypes.enabled, true)))
    .orderBy(asc(entityTypes.label));
  if (rows.length === 0) return resolveEntityTypes([]);

  const fieldRows = await db
    .select()
    .from(entityTypeFields)
    .orderBy(asc(entityTypeFields.position));
  const byType = new Map<string, typeof fieldRows>();
  for (const field of fieldRows) {
    const existing = byType.get(field.typeId);
    if (existing) existing.push(field);
    else byType.set(field.typeId, [field]);
  }

  const declared: EntityTypeDef[] = [];
  for (const row of rows) {
    const def = typeFromRows(row, byType.get(row.id) ?? []);
    if (!def) {
      // The check constraints make this unreachable from SQL; if it happens
      // anyway, one unusable type must not cost the message its summary.
      log.warn("skipping an entity type this build cannot compile", { kind: row.kind });
      continue;
    }
    declared.push(def);
  }
  return resolveEntityTypes(declared);
}

/**
 * Give an account the starter set, once and only once.
 *
 * Gated on `user.types_seeded_at` rather than on "has no types", which is the
 * whole point: a user who deleted Phone Number must not have it reappear on
 * their next message, and a user who deleted everything keeps their empty archive
 * empty. The timestamp is claimed in the same transaction that writes the rows,
 * with a conditional update, so the signup hook and the ingestion safety net
 * racing each other end with one of them doing nothing.
 *
 * Returns whether this call is the one that seeded.
 */
export async function seedEntityTypes(userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(user)
      .set({ typesSeededAt: new Date() })
      .where(and(eq(user.id, userId), isNull(user.typesSeededAt)))
      .returning({ id: user.id });
    if (claimed.length === 0) return false;

    for (const def of STARTER_SET) {
      const row = typeRowFor(def);
      const typeId = newId();
      await tx.insert(entityTypes).values({
        id: typeId,
        userId,
        kind: row.kind,
        label: row.label,
        sidebarTitle: row.sidebarTitle,
        slug: row.slug,
        icon: row.icon,
        hint: row.hint,
        titleTemplate: row.titleTemplate,
        examples: [...(row.examples ?? [])],
        sidebar: row.sidebar,
        enabled: true,
        origin: "catalog",
      });
      await tx.insert(entityTypeFields).values(
        fieldRowsFor(def).map((spec) => ({
          id: newId(),
          typeId,
          name: spec.name,
          label: spec.label,
          type: spec.type as (typeof entityTypeFields.$inferInsert)["type"],
          values: spec.values ? [...spec.values] : null,
          required: spec.required,
          description: spec.description,
          position: spec.position,
          keyRank: spec.keyRank,
        })),
      );
    }
    log.info("seeded the starter entity types", { userId, types: STARTER_SET.length });
    return true;
  });
}
