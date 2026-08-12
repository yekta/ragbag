CREATE TABLE "ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item_id" text,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_chunk" (
	"item_id" text NOT NULL,
	"user_id" text NOT NULL,
	"idx" integer NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_chunk_item_id_idx_pk" PRIMARY KEY("item_id","idx")
);
--> statement-breakpoint
ALTER TABLE "item_chunk" ADD CONSTRAINT "item_chunk_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_user_created_idx" ON "ai_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "item_chunk_user_idx" ON "item_chunk" USING btree ("user_id");--> statement-breakpoint
-- Everything below is managed outside drizzle's model (raw-SQL access only).
-- Keyword search column: language-agnostic 'simple' config — the corpus is
-- multilingual and tags/summaries do the semantic lifting (plan §8).
ALTER TABLE "item_chunk" ADD COLUMN "tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', "content")) STORED;--> statement-breakpoint
CREATE INDEX "item_chunk_tsv_idx" ON "item_chunk" USING gin ("tsv");--> statement-breakpoint
-- Embedding column + HNSW index only where pgvector is installed (migration
-- 0001 creates the extension when available; compose/Railway images ship it,
-- bare local Postgres may not — the worker checks at runtime and skips
-- embedding writes, which are backfillable via the Batch API later).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    ALTER TABLE "item_chunk" ADD COLUMN IF NOT EXISTS "embedding" vector(1536);
    CREATE INDEX IF NOT EXISTS "item_chunk_embedding_idx" ON "item_chunk"
      USING hnsw ("embedding" vector_cosine_ops);
  ELSE
    RAISE NOTICE 'pgvector not installed; item_chunk.embedding skipped (needed for Tier-2 search)';
  END IF;
END
$$;