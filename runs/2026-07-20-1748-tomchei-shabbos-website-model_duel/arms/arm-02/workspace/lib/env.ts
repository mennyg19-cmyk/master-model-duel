import { z } from "zod";

// Repo-committed secret for the MOCK gateway only. Real mode (STRIPE_SECRET_KEY
// set) and production both fail startup if the webhook secret is still this value.
export const DEV_WEBHOOK_SECRET = "whsec_dev_mock_secret";

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
    APP_URL: z.string().default("http://127.0.0.1:3102"),
  })
  .refine(
    (vars) => vars.AUTH_MODE !== "clerk" || (vars.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && vars.CLERK_SECRET_KEY),
    { message: "AUTH_MODE=clerk requires NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY" }
  )
  // Fail-closed money guards: the webhook route authenticates every Stripe
  // event with STRIPE_WEBHOOK_SECRET, so real mode must never run with the
  // public repo default, and production must never fall back to the mock gateway.
  .superRefine((vars, ctx) => {
    if (vars.STRIPE_SECRET_KEY && vars.STRIPE_WEBHOOK_SECRET === DEV_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["STRIPE_WEBHOOK_SECRET"],
        message:
          "STRIPE_SECRET_KEY is set (real mode) but STRIPE_WEBHOOK_SECRET is still the public dev default — set the endpoint secret from the Stripe dashboard",
      });
    }
    if (process.env.NODE_ENV === "production" && !isBuildPhase && !vars.STRIPE_SECRET_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["STRIPE_SECRET_KEY"],
        message: "STRIPE_SECRET_KEY is required in production — the mock payment gateway is dev-only",
      });
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
