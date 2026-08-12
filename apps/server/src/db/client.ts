import { schema as zeroSchema } from "@ragbag/contracts";
import { zeroDrizzle } from "@rocicorp/zero/server/adapters/drizzle";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env.js";
import * as dbSchema from "./schema.js";

export const sql = postgres(env.DATABASE_URL, {
  onnotice: () => {}, // silence NOTICEs from idempotent DDL
});

export const db = drizzle(sql, { schema: dbSchema });

// ZQL-capable database used by /api/zero/mutate to run the shared mutators
// authoritatively inside a Postgres transaction.
export const dbProvider = zeroDrizzle(zeroSchema, db);

// Types tx.dbTransaction.wrappedTransaction for server-side mutator code.
declare module "@rocicorp/zero" {
  interface DefaultTypes {
    dbProvider: typeof dbProvider;
  }
}
