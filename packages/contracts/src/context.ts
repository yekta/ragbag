// The context both endpoints derive from the authenticated session (server)
// and the client mirrors for optimistic runs. Zero 1.x has no separate
// permission system: every query and mutator scopes rows to ctx.userID, and
// the server derives ctx from the verified session — that IS the authorization.
//
// The registered context is non-optional: the endpoints 401 before ever
// invoking a query/mutator without a session, and clients only construct Zero
// after sign-in.
export type AuthData = {
  userID: string;
};

/** Defensive runtime check for mutators (types say ctx exists; verify anyway). */
export function mustBeLoggedIn(ctx: AuthData | undefined): AuthData {
  if (!ctx?.userID) {
    throw new Error("Not authenticated");
  }
  return ctx;
}

declare module "@rocicorp/zero" {
  interface DefaultTypes {
    context: AuthData;
  }
}
