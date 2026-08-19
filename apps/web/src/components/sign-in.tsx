import type { MetaResponse } from "@ragbag/contracts";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { authClient, OAUTH_REDIRECT_ERROR, signInWithGoogle } from "@/lib/auth-client";
import { dropLocalData } from "@/lib/identity";

/**
 * `meta` is passed in, not fetched here: which buttons exist is a server
 * capability, so a card drawn before the answer arrives is a card that changes
 * shape under the cursor. The app shell holds the canvas until it knows, and
 * this screen paints once, complete.
 *
 * `null` means the shell gave up waiting: the server is unreachable, which is
 * a state to explain rather than a wait to hide.
 */
export function SignIn({ meta }: { meta: MetaResponse | null }) {
  // Seeded, not empty: arriving here straight off a failed Google round trip is
  // indistinguishable from a first visit unless the error survives the redirect.
  const [error, setError] = useState<string | undefined>(OAUTH_REDIRECT_ERROR);

  // This screen only shows when no device identity exists: first visit, or
  // right after an explicit sign-out. Clearing local stores here (not during
  // sign-out) lets Zero close first; on a fresh browser it's a no-op.
  useEffect(() => {
    void dropLocalData();
  }, []);

  return (
    // No `bg-background` here: `body` already paints the canvas, and this box
    // is `h-dvh` rather than the full canvas, so repainting the same token
    // draws a second copy of it over part of the screen, and the seam shows the
    // moment the two paints quantise differently (index.css rule 3).
    <main className="flex h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm shadow-float">
        <CardHeader className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Icon name="inbox" className="size-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Ragbag</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Send anything. Find everything, even offline.
            </p>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-2">
          {meta?.googleAuth && (
            <Button
              size="lg"
              onClick={() => {
                setError(undefined);
                void signInWithGoogle().then(setError);
              }}
            >
              Continue with Google
            </Button>
          )}
          {meta?.devLogin && (
            <Button
              variant="outline"
              onClick={() => {
                setError(undefined);
                void authClient.signIn
                  .anonymous()
                  .then(({ error: err }) => setError(err?.message ?? undefined));
              }}
            >
              Dev sign-in (anonymous)
            </Button>
          )}
          {error && <p className="text-center text-sm text-destructive">{error}</p>}
          {meta && !meta.googleAuth && !meta.devLogin && (
            <p className="text-center text-sm text-destructive">
              This server has neither Google OAuth nor DEV_LOGIN configured. There is nothing to
              sign in with.
            </p>
          )}
          {!meta && (
            <p className="text-center text-sm text-destructive">
              Can't reach the server. Your archive is safe; this is only the way in. Retrying
              automatically.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
