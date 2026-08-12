-- Zero replicates only the client-synced tables (plan §4). A dedicated
-- publication keeps auth tables, blobs, jobs, and (later) embedding chunks
-- out of the replication stream. zero-cache is pointed at it via
-- ZERO_APP_PUBLICATIONS=zero_data.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'zero_data') THEN
    CREATE PUBLICATION zero_data
      FOR TABLE "item", "item_content", "tag", "item_tag", "collection", "collection_item";
  END IF;
END
$$;
--> statement-breakpoint
-- pgvector backs semantic search from M4/M7 on. Optional here so local
-- Postgres installs without the extension still boot; the compose/Railway
-- images ship it.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector not available; skipping (needed from M4)';
END
$$;
