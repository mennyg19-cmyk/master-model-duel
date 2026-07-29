import { z } from "zod";

// Single source of truth for env config. lib/env.ts builds the runtime schema
// from this; scripts/gen-env-example.mts renders .env.example from it.
export const ENV_SPEC = [
  {
    key: "DATABASE_URL",
    description: "Postgres connection string (embedded Postgres on port 4106 locally)",
    example: "postgresql://postgres:postgres@127.0.0.1:4106/app",
    schema: z.string().url(),
    secret: false,
  },
  {
    key: "AUTH_SECRET",
    description: "HMAC secret for session cookies (min 32 chars; use crypto-random bytes)",
    example: "generate-a-long-random-string",
    schema: z.string().min(32),
    secret: true,
  },
  {
    key: "DEV_AUTH_BYPASS",
    description:
      "Dev-only login without Clerk (true/false). Hard-disabled on Vercel production deploys regardless of this value.",
    example: "false",
    schema: z.enum(["true", "false"]).default("false"),
    secret: false,
  },
  {
    key: "STRIPE_SECRET_KEY",
    description:
      "Stripe secret key for hosted Checkout + refunds (P5). Optional: without it, card checkout returns 503 'not configured' and every other checkout step still works.",
    example: "sk_test_xxxx",
    schema: z.string().min(1).optional(),
    secret: true,
  },
  {
    key: "STRIPE_WEBHOOK_SECRET",
    description:
      "Stripe webhook signing secret (whsec_…) for /api/webhooks/stripe. Optional locally: without it the webhook route 503s. Set a dev value to exercise the webhook with signed fixtures.",
    example: "whsec_xxxx",
    schema: z.string().min(1).optional(),
    secret: true,
  },
  {
    key: "BLOB_READ_WRITE_TOKEN",
    description:
      "Vercel Blob token for media uploads (R-180). Optional: without it, uploads use the local .uploads/ driver.",
    example: "vercel_blob_rw_xxxx",
    schema: z.string().min(1).optional(),
    secret: true,
  },
  {
    key: "CRON_SECRET",
    description:
      "Bearer secret for /api/cron/* endpoints (R-124; P7 nightly print batch). Optional locally: without it, cron routes 401 every caller (configuration state is never revealed pre-auth).",
    example: "generate-a-long-random-string",
    schema: z.string().min(1).optional(),
    secret: true,
  },
] as const;

export type EnvKey = (typeof ENV_SPEC)[number]["key"];
