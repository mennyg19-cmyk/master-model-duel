// Single source for the dev-login bypass predicate (SR-05): lib/env.ts and
// middleware.ts must agree, or a misconfigured deploy redirects
// unauthenticated admin visitors to a /dev-login that 404s. Reads raw
// process.env so the middleware (edge bundle) never pulls in the zod env
// parse. Equivalent to the parsed values: both flags default fail-closed
// ("false" / "production"), so unset env reads the same as the defaults.
//
// Dev-auth is hard-disabled on ANY Vercel deploy no matter what the flag
// says: production is obvious, but a preview deploy is also a public URL, so
// a leaked DEV_AUTH_BYPASS=true must never open either one. The Vercel guard
// alone is platform-specific, though — a container or CI host never sets
// VERCEL_ENV, so the fail-closed, platform-agnostic gate is the APP_ENV
// class itself: only an explicit APP_ENV=test lets the bypass exist at all.
export function isDevAuthBypassEnabled(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  return (
    process.env.DEV_AUTH_BYPASS === "true" &&
    process.env.APP_ENV === "test" &&
    vercelEnv !== "production" &&
    vercelEnv !== "preview"
  );
}
