import { z } from "zod";

// Repo-committed secret for the MOCK gateway only. Real mode (STRIPE_SECRET_KEY
// set) and production both fail startup if the webhook secret is still this value.
export const DEV_WEBHOOK_SECRET = "whsec_dev_mock_secret";

// Publicly-known SESSION_SECRET values (shipped in .env.example / docs). An
// operator who copies one unchanged would sign every staff session with an
// HMAC key anyone can read from the repo — real mode refuses to start (B1,
// same fail-closed posture as the Stripe webhook secret guard below).
const PUBLIC_SESSION_SECRET_DEFAULTS = new Set([
  "change-me-to-a-random-string",
  // The dev secret shipped in this tree's .env — exactly as public as the
  // .env.example placeholder, so real mode must refuse it too.
  "dev-only-secret-not-for-production-1748",
]);

// `next build` evaluates modules with NODE_ENV=production before any real env
// exists; the production-only guards must not fire during the build phase.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required (postgres connection string)"),
    AUTH_MODE: z.enum(["dev", "clerk"]).default("dev"),
    SESSION_SECRET: z
      .string()
      .min(16, "SESSION_SECRET must be at least 16 characters (used to sign session tokens)"),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
    CLERK_SECRET_KEY: z.string().optional(),
    // Media library target. Unset = local-disk fallback (.uploads/) for dev.
    BLOB_READ_WRITE_TOKEN: z.string().optional(),
    // Set to "true" ONLY when serving behind a reverse proxy that appends the
    // real client IP to X-Forwarded-For. Off by default: a direct-served node
    // must never trust that header (spoofable rate-limit keys).
    TRUST_PROXY: z
      .string()
      .optional()
      .transform((value) => value === "true" || value === "1"),
    // Stripe (P5). With no secret key the gateway runs in mock mode: a local
    // hosted-checkout stand-in that signs and posts events through the REAL
    // webhook route, so the money path is identical either way.
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().default(DEV_WEBHOOK_SECRET),
    // Absolute base URL for Stripe redirect/webhook URLs.
    APP_URL: z.string().default("http://127.0.0.1:3103"),
    // Shippo (P8). Without a token the shipping wrapper runs in mock mode with
    // deterministic fixture rates, same philosophy as the Stripe mock gateway.
    SHIPPO_API_TOKEN: z.string().optional(),
    // Org-negotiated carrier accounts registered in Shippo. Required together
    // with the token in live mode; the UPS slot is also the declared home for
    // UPS credentials (plan P8 declaration-only carry).
    SHIPPO_FEDEX_ACCOUNT_ID: z.string().optional(),
    SHIPPO_UPS_ACCOUNT_ID: z.string().optional(),
    // Optional USPS carrier account: when set, live getRates quotes USPS
    // alongside the negotiated FedEx/UPS accounts (EXPECTED §2).
    SHIPPO_USPS_ACCOUNT_ID: z.string().optional(),
    // Bearer secret for /api/cron/* (R-182). Unset = every cron endpoint
    // refuses with 503 — scheduled jobs never run unauthenticated.
    CRON_SECRET: z.string().min(16).optional(),
    // Mapbox geocoding (P9, R-179). Without a token the geocoder falls back to
    // the local deterministic provider — same swap point as Stripe/Shippo mocks.
    MAPBOX_ACCESS_TOKEN: z.string().optional(),
    // Resend (P11, R-171). Required when EMAIL_MODE=live.
    RESEND_API_KEY: z.string().optional(),
    // Provider mode switch (wired — do not leave as dead env). capture|mock|live.
    // EMAIL_TEST_MODE=true still forces capture for both channels (R-178).
    EMAIL_MODE: z.enum(["capture", "mock", "live"]).default("mock"),
    SMS_MODE: z.enum(["capture", "mock", "live"]).default("capture"),
    // Optional default From used when settings row is missing / empty.
    EMAIL_FROM: z.string().email().optional(),
    // Test mode (R-178): outgoing email/SMS is CAPTURED in the outbox instead
    // of ever contacting a provider — even when live keys are configured.
    EMAIL_TEST_MODE: z
      .string()
      .optional()
      .transform((value) => value === "true" || value === "1"),
    // Explicit test-environment switch (P12, R-101/R-129). Test mode is also
    // inferred from mock money (no STRIPE_SECRET_KEY) — see lib/test-mode.ts.
    TEST_MODE: z
      .string()
      .optional()
      .transform((value) => value === "true" || value === "1"),
    // Twilio-class SMS (P11, G-021). All three required together for live mode.
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),
  })
  .refine(
    (vars) => vars.AUTH_MODE !== "clerk" || (vars.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && vars.CLERK_SECRET_KEY),
    { message: "AUTH_MODE=clerk requires NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY" }
  )
  // Fail-closed money guards: the webhook route authenticates every Stripe
  // event with STRIPE_WEBHOOK_SECRET, so real mode must never run with the
  // public repo default, and production must never fall back to the mock gateway.
  .superRefine((vars, ctx) => {
    // Real mode = anything beyond the purely-local mock harness: production
    // runtime, or a live Stripe/Shippo credential present. The secret that
    // signs every staff session must never be a repo-published value there.
    const realMode =
      (process.env.NODE_ENV === "production" && !isBuildPhase) ||
      Boolean(vars.STRIPE_SECRET_KEY) ||
      Boolean(vars.SHIPPO_API_TOKEN);
    if (realMode && PUBLIC_SESSION_SECRET_DEFAULTS.has(vars.SESSION_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["SESSION_SECRET"],
        message:
          "SESSION_SECRET is still the public .env.example placeholder — staff sessions would be forgeable. Generate a random secret (e.g. `openssl rand -hex 32`)",
      });
    }
    if (vars.STRIPE_SECRET_KEY && vars.STRIPE_WEBHOOK_SECRET === DEV_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["STRIPE_WEBHOOK_SECRET"],
        message:
          "STRIPE_SECRET_KEY is set (real mode) but STRIPE_WEBHOOK_SECRET is still the public dev default — set the endpoint secret from the Stripe dashboard",
      });
    }
    // Live Shippo without the org carrier accounts would silently quote retail
    // rates — refuse the half-configured state (R-183, R-184).
    if (vars.SHIPPO_API_TOKEN && (!vars.SHIPPO_FEDEX_ACCOUNT_ID || !vars.SHIPPO_UPS_ACCOUNT_ID)) {
      ctx.addIssue({
        code: "custom",
        path: ["SHIPPO_API_TOKEN"],
        message:
          "SHIPPO_API_TOKEN is set (live mode) but SHIPPO_FEDEX_ACCOUNT_ID / SHIPPO_UPS_ACCOUNT_ID are missing — live rates must use the org's negotiated carrier accounts",
      });
    }
    // Rate-limit keys collapse to one shared bucket without a trusted client
    // IP: 20 failed logins from anyone would lock out every user. Production
    // always sits behind a proxy (Vercel or a reverse proxy), so refuse to
    // start until TRUST_PROXY=true is set deliberately.
    if (process.env.NODE_ENV === "production" && !isBuildPhase && !vars.TRUST_PROXY) {
      ctx.addIssue({
        code: "custom",
        path: ["TRUST_PROXY"],
        message:
          "TRUST_PROXY=true is required in production — without it every client shares one rate-limit bucket (trivial lockout DoS). Set it when serving behind Vercel or a reverse proxy that appends the client IP to X-Forwarded-For",
      });
    }
    if (process.env.NODE_ENV === "production" && !isBuildPhase && !vars.STRIPE_SECRET_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["STRIPE_SECRET_KEY"],
        message: "STRIPE_SECRET_KEY is required in production — the mock payment gateway is dev-only",
      });
    }
    // Half-configured Twilio would fail at first send instead of at startup.
    const twilioVars = [vars.TWILIO_ACCOUNT_SID, vars.TWILIO_AUTH_TOKEN, vars.TWILIO_FROM_NUMBER];
    const twilioSet = twilioVars.filter(Boolean).length;
    if (twilioSet > 0 && twilioSet < 3) {
      ctx.addIssue({
        code: "custom",
        path: ["TWILIO_ACCOUNT_SID"],
        message: "Live SMS needs all three of TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER",
      });
    }
    // Production must never "send" through the mock email provider (customers
    // would silently get nothing) — require live+key, capture, or EMAIL_TEST_MODE.
    const emailCaptured = vars.EMAIL_TEST_MODE || vars.EMAIL_MODE === "capture";
    if (process.env.NODE_ENV === "production" && !isBuildPhase && !emailCaptured && !vars.RESEND_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message:
          "RESEND_API_KEY is required in production when EMAIL_MODE is mock/live (or set EMAIL_MODE=capture / EMAIL_TEST_MODE=true)",
      });
    }
    if (vars.EMAIL_MODE === "live" && !vars.RESEND_API_KEY && !vars.EMAIL_TEST_MODE) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "EMAIL_MODE=live requires RESEND_API_KEY (or EMAIL_TEST_MODE=true to capture)",
      });
    }
    if (vars.SMS_MODE === "live") {
      const twilioVars = [vars.TWILIO_ACCOUNT_SID, vars.TWILIO_AUTH_TOKEN, vars.TWILIO_FROM_NUMBER];
      if (twilioVars.filter(Boolean).length < 3 && !vars.EMAIL_TEST_MODE) {
        ctx.addIssue({
          code: "custom",
          path: ["SMS_MODE"],
          message: "SMS_MODE=live requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER",
        });
      }
    }
  });

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Environment validation failed. Fix these variables (see .env.example):\n${problems}`
    );
  }
  return parsed.data;
}

export const env = loadEnv();
