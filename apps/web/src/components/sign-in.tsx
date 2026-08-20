import type { MetaResponse } from "@ragbag/contracts";
import { useEffect, useState, useTransition } from "react";
import { Logo } from "@/components/logo";
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

  // One transition per button, because each is its own action and only the one
  // that was pressed should be spinning.
  //
  // A transition rather than a `useState` boolean of our own: React holds
  // `pending` for exactly as long as the async function runs, including the
  // part after the await, so there is no pair of set-calls to keep in step and
  // no way to leave a button spinning by returning early. The Google leg never
  // resolves at all when it works, the browser having left for accounts.google
  // .com, and a button that stays busy until the page goes is the honest state.
  const [signingIn, startSignIn] = useTransition();
  const [devSigningIn, startDevSignIn] = useTransition();

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
          <Logo className="size-10" />
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
              variant="foreground"
              pending={signingIn}
              onClick={() =>
                startSignIn(async () => {
                  setError(undefined);
                  setError(await signInWithGoogle());
                })
              }
            >
              Continue with Google
            </Button>
          )}
          {meta?.devLogin && (
            <Button
              variant="outline"
              pending={devSigningIn}
              onClick={() =>
                startDevSignIn(async () => {
                  setError(undefined);
                  const { error: err } = await authClient.signIn.anonymous();
                  setError(err?.message ?? undefined);
                })
              }
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
