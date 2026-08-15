-- Favorites replace pins: same column, honest name. A RENAME (not drop+add)
-- keeps every existing flag. zero-cache sees a column rename on a replicated
-- table: restart it after this migration; if it refuses the change, delete
-- its replica file (ZERO_REPLICA_FILE) and let it resync from Postgres.
ALTER TABLE "item" RENAME COLUMN "pinned" TO "favorite";--> statement-breakpoint
-- Todos (item.kind = 'todo'): null while open, set when checked off.
ALTER TABLE "item" ADD COLUMN "completed_at" timestamp with time zone;
