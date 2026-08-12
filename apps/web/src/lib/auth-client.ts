import { anonymousClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Same-origin: the Vite dev server proxies /api to the API server, so the
// session cookie stays first-party. anonymousClient only does anything when
// the server has DEV_LOGIN enabled.
export const authClient = createAuthClient({
  plugins: [anonymousClient()],
});
