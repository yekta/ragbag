DROP INDEX "blob_user_sha256_idx";--> statement-breakpoint
CREATE INDEX "blob_user_sha256_idx" ON "blob" USING btree ("user_id","sha256");