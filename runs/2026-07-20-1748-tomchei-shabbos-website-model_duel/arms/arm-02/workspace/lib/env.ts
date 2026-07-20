import { z } from "zod";

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
    STRIPE_WEBHOOK_SECRET: z.string().default("whsec_dev_mock_secret"),
    // Absolute base URL for Stripe redirect/webhook URLs.
    APP_URL: z.string().default("http://127.0.0.1:3102"),
  })
  .refine(
    (vars) => vars.AUTH_MODE !== "clerk" || (vars.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && vars.CLERK_SECRET_KEY),
    { message: "AUTH_MODE=clerk requires NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY" }
  );

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
