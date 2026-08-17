-- Zero replicates only the client-synced tables (plan §3.4). A dedicated
-- publication keeps the auth tables, blobs, the job queue and the AI usage
-- ledger out of the replication stream. zero-cache is pointed at it with
-- ZERO_APP_PUBLICATIONS=zero_data.
--
-- Hand-written: this is not something drizzle-kit models, and it has to list
-- exactly the set in packages/contracts/src/schema.ts. A table synced by Zero
-- but missing here reaches the client as a permanently empty view.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'zero_data') THEN
    CREATE PUBLICATION zero_data
      FOR TABLE "messages", "attachments", "attachment_contents",
                "entities", "message_entities",
                "tags", "message_tags", "attachment_tags", "entity_tags";
  END IF;
END
$$;
