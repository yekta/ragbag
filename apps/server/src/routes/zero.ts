import { mutators, queries, schema } from "@ragbag/contracts";
import { mustGetMutator, mustGetQuery } from "@rocicorp/zero";
import { handleMutateRequest, handleQueryRequest } from "@rocicorp/zero/server";
import { Hono } from "hono";
import { dbProvider } from "../db/client.js";
import { getAuthData } from "../session.js";

// The two endpoints zero-cache calls (plan §5). Authorization happens here:
// ctx is derived from the verified session, and every shared query/mutator
// scopes rows to ctx.userID. 401 puts the Zero client into its needs-auth
// state; it keeps working locally and re-syncs after sign-in.

export const zeroRoutes = new Hono()
  .post("/mutate", async (c) => {
    const authData = await getAuthData(c.req.raw);
    if (!authData) return c.json({ error: "unauthorized" }, 401);

    const result = await handleMutateRequest({
      dbProvider,
      handler: (transact) =>
        transact(async (tx, name, args) => {
          const mutator = mustGetMutator(mutators, name);
          await mutator.fn({ tx, ctx: authData, args });
        }),
      request: c.req.raw,
      userID: authData.userID,
    });
    return c.json(result);
  })
  .post("/query", async (c) => {
    const authData = await getAuthData(c.req.raw);
    if (!authData) return c.json({ error: "unauthorized" }, 401);

    const result = await handleQueryRequest({
      handler: (name, args) => {
        const query = mustGetQuery(queries, name);
        return query.fn({ args, ctx: authData });
      },
      schema,
      request: c.req.raw,
      userID: authData.userID,
    });
    return c.json(result);
  });
