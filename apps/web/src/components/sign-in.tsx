import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { authClient, signInWithGoogle } from "@/lib/auth-client";
import { dropLocalData } from "@/lib/identity";
import { useMeta } from "@/lib/use-meta";

export function SignIn() {
  const meta = useMeta();
  const [error, setError] = useState<string>();

  // This screen only shows when no device identity exists — first visit, or
  // right after an explicit sign-out. Clearing local stores here (not during
  // sign-out) lets Zero close first; on a fresh browser it's a no-op.
  useEffect(() => {
    void dropLocalData();
  }, []);

  return (
    <main className="flex h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm shadow-float">
        <CardHeader className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Icon name="inbox" className="size-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">ragbag</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Dump anything. Find everything — even offline.
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
              This server has neither Google OAuth nor DEV_LOGIN configured — there is nothing to
              sign in with.
            </p>
          )}
          {!meta && (
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Icon name="spinner" className="size-4 animate-spin [animation-duration:2s]" />
              Reaching the server…
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
