-- The two things drizzle-kit cannot model, so the two things it cannot generate:
-- the replication publication zero-cache reads, and the trigger that keeps an
-- entity type's version honest. `drizzle-kit generate --custom` scaffolds this
-- file and its journal entry; only the SQL below is written by hand.

-- 1. Zero replicates only the client-synced tables (plan §3.4). A dedicated
-- publication keeps the auth tables, blobs, the job queue and the AI usage
-- ledger out of the replication stream. zero-cache is pointed at it with
-- ZERO_APP_PUBLICATIONS=zero_data, and it has to list exactly the set in
-- packages/contracts/src/schema.ts: a table Zero syncs but this omits reaches
-- the client as a permanently empty view.
--
-- `entity_types` and `entity_type_fields` are in it because a type is the user's
-- own now: the settings screen edits these rows through mutators, and the web
-- app needs every kind's labels, icon, slug and field list to draw its cards,
-- its rail row and its Details list.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'zero_data') THEN
    CREATE PUBLICATION zero_data
      FOR TABLE "messages", "attachments", "attachment_contents",
                "entities", "message_entities",
                "entity_types", "entity_type_fields",
                "tags", "message_tags", "attachment_tags", "entity_tags";
  END IF;
END
$$;
--> statement-breakpoint

-- 2. `entity_types.version` is what "the shape moved under this entity" means:
-- ingestion stamps it onto every entity it writes (`entities.type_version`), and
-- a later run that finds a newer version replaces `data` instead of merging into
-- it, so a renamed or deleted field does not leave its old spelling in the jsonb
-- forever.
--
-- Which is only true if the bump cannot be forgotten. A type is seeded with an
-- `insert`, edited through a mutator from the settings screen, and fixed up in
-- psql when it has to be, so the bump belongs to the database rather than to
-- whichever writer remembered it.
--
-- The type itself: bump when anything but the bookkeeping columns changed, and
-- only if the writer did not set `version` explicitly (which is what the field
-- trigger below does, and how this stays out of its own way).
CREATE OR REPLACE FUNCTION entity_type_touched() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version = OLD.version
     AND (to_jsonb(NEW) - 'version' - 'updated_at')
         IS DISTINCT FROM (to_jsonb(OLD) - 'version' - 'updated_at') THEN
    NEW.version := OLD.version + 1;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER entity_types_touched
  BEFORE UPDATE ON "entity_types"
  FOR EACH ROW EXECUTE FUNCTION entity_type_touched();
--> statement-breakpoint

-- A field is part of its type's shape, so adding, editing or dropping one is a
-- change to the type. Setting `version` explicitly here is what stops the
-- trigger above from bumping it a second time.
--
-- On a cascade delete the parent row is already gone, so the update matches no
-- rows and this is a no-op.
CREATE OR REPLACE FUNCTION entity_type_field_touched() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "entity_types"
     SET version = version + 1, updated_at = now()
   WHERE id = COALESCE(NEW.type_id, OLD.type_id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER entity_type_fields_touched
  AFTER INSERT OR UPDATE OR DELETE ON "entity_type_fields"
  FOR EACH ROW EXECUTE FUNCTION entity_type_field_touched();
