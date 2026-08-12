import { authClient } from "../lib/auth-client.js";
import { useMeta } from "../lib/use-meta.js";
import { Icon } from "./Icon.js";

export function SignIn() {
  const meta = useMeta();
  return (
    <main className="flex h-dvh items-center justify-center bg-neutral-50">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-neutral-900 text-white">
            <Icon name="inbox" className="size-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">ragbag</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Dump anything. Find everything — even offline.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {meta?.googleAuth && (
            <button
              className="flex items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 py-2.5 font-medium text-white transition hover:bg-neutral-700"
              onClick={() =>
                void authClient.signIn.social({ provider: "google", callbackURL: "/" })
              }
            >
              Continue with Google
            </button>
          )}
          {meta?.devLogin && (
            <button
              className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm text-neutral-700 transition hover:bg-neutral-50"
              onClick={() => void authClient.signIn.anonymous()}
            >
              Dev sign-in (anonymous)
            </button>
          )}
          {meta && !meta.googleAuth && !meta.devLogin && (
            <p className="text-center text-sm text-red-600">
              This server has neither Google OAuth nor DEV_LOGIN configured — there is nothing to
              sign in with.
            </p>
          )}
          {!meta && (
            <p className="flex items-center justify-center gap-2 text-sm text-neutral-400">
              <Icon name="spinner" className="size-4 animate-spin [animation-duration:2s]" />
              Reaching the server…
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
