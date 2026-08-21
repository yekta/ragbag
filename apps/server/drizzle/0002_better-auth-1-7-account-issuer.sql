-- Better Auth 1.7 makes issuer part of an external account's identity. Add it
-- nullable first so existing accounts can be assigned their real, trusted
-- issuer before the NOT NULL constraint and unique identity index go live.
ALTER TABLE "account" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "account"
SET "issuer" = 'https://accounts.google.com'
WHERE "provider_id" = 'google';--> statement-breakpoint
UPDATE "account"
SET "issuer" = 'local:credential', "account_id" = "user_id"
WHERE "provider_id" = 'credential';--> statement-breakpoint
UPDATE "account"
SET "issuer" = 'local:siwe'
WHERE "provider_id" = 'siwe';--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "account" WHERE "issuer" IS NULL) THEN
		RAISE EXCEPTION 'Cannot migrate Better Auth account issuer: unknown provider_id exists';
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_account_id_uidx" ON "account" USING btree ("issuer","account_id");
