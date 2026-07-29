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
    key: "STRIPE_BASE_URL",
    description:
      "Stripe API base URL override. Defaults to https://api.stripe.com. Local seam: point at the in-app dev double (/api/dev/stripe-fixture) to exercise the P12 reconciliation matcher end-to-end — the double only serves when DEV_AUTH_BYPASS=true.",
    example: "http://127.0.0.1:3106/api/dev/stripe-fixture",
    schema: z.string().url().optional(),
    secret: false,
  },
  {
    key: "APP_ENV",
    description:
      "Deployment environment class (test|production). Drives the P12 test-mode banner (R-014) and gates the test-only destructive routes under /api/admin/test-ops/* (R-129): production refuses them outright. Fail-closed: the default is production, so a deploy that forgets this var keeps the destructive routes (and the dev-auth seam) disabled — only an explicit 'test' opens them.",
    example: "production",
    schema: z.enum(["test", "production"]).default("production"),
    secret: false,
  },
  {
    key: "LIVE_BASE_URL",
    description:
      "Public URL of the live deployment (R-103 env switch). Optional: the admin env-switch link renders only when this is set.",
    example: "https://tomchei-shabbos.vercel.app",
    schema: z.string().url().optional(),
    secret: false,
  },
  {
    key: "TEST_BASE_URL",
    description:
      "Public URL of the test deployment (R-103 env switch). Optional: the storefront test banner links here from live only when set.",
    example: "https://tomchei-shabbos-test.vercel.app",
    schema: z.string().url().optional(),
    secret: false,
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
  {
    key: "SHIPPO_API_TOKEN",
    description:
      "Shippo API token (P8; R-173/R-183). Optional: without it, carrier shipping answers 503 'not configured' and every other checkout path still works.",
    example: "shippo_test_xxxx",
    schema: z.string().min(1).optional(),
    secret: true,
  },
  {
    key: "SHIPPO_BASE_URL",
    description:
      "Shippo API base URL override. Defaults to https://api.goshippo.com. Local seam: point at the in-app dev double (/api/dev/shippo-fixture) to exercise the wrapper without a live account — the double only serves when DEV_AUTH_BYPASS=true.",
    example: "http://127.0.0.1:3106/api/dev/shippo-fixture",
    schema: z.string().url().optional(),
    secret: false,
  },
  {
    key: "SHIPPO_FEDEX_ACCOUNT_ID",
    description:
      "Shippo carrier-account object id for the org's negotiated FedEx account (resolution 6). Optional: omitted from rate requests when unset.",
    example: "a1b2c3d4e5f6",
    schema: z.string().min(1).optional(),
    secret: false,
  },
  {
    key: "SHIPPO_UPS_ACCOUNT_ID",
    description:
      "Shippo carrier-account object id for the org's negotiated UPS account (resolution 6). Optional: omitted from rate requests when unset.",
    example: "f6e5d4c3b2a1",
    schema: z.string().min(1).optional(),
    secret: false,
  },
  {
    key: "SHIPPO_INCLUDE_USPS",
    description:
      "Include USPS rates in the margin engine where applicable (true/false, default false). Org accounts are FedEx + UPS; USPS comes through Shippo's default account when enabled.",
    example: "false",
    schema: z.enum(["true", "false"]).default("false"),
    secret: false,
  },
  {
    key: "MAPBOX_ACCESS_TOKEN",
    description:
      "Mapbox access token (P9; R-074/R-179). Optional: without it, route stop ordering uses the deterministic nearest-neighbor optimizer over the geocode cache; with it, the Mapbox Optimization API orders stops (nearest-neighbor fallback on any provider failure).",
    example: "pk.xxxx",
    schema: z.string().min(1).optional(),
    secret: true,
  },
  {
    key: "RESEND_API_KEY",
    description:
      "Resend API key (P11; R-171). Optional: without it, outbound email runs in capture mode — outbox rows are marked SENT with a capture:* provider id and no provider is ever contacted (same honesty class as the P5/P8 seams).",
    example: "re_xxxx",
    schema: z.string().min(1).optional(),
    secret: true,
  },
  {
    key: "RESEND_BASE_URL",
    description:
      "Resend API base URL override. Defaults to https://api.resend.com. Local seam: point at the in-app dev double (/api/dev/email-fixture) to exercise the wrapper end-to-end — the double only serves when DEV_AUTH_BYPASS=true.",
    example: "http://127.0.0.1:3106/api/dev/email-fixture",
    schema: z.string().url().optional(),
    secret: false,
  },
  {
    key: "TWILIO_ACCOUNT_SID",
    description:
      "Twilio account SID for SMS dispatch (P11; G-021 channel wiring for the P9 notifications). Optional: without it, SMS outbox rows capture instead of contacting a provider.",
    example: "ACxxxx",
    schema: z.string().min(1).optional(),
    secret: true,
  },
  {
    key: "TWILIO_AUTH_TOKEN",
    description: "Twilio auth token. Optional locally — see TWILIO_ACCOUNT_SID.",
    example: "xxxx",
    schema: z.string().min(1).optional(),
    secret: true,
  },
  {
    key: "TWILIO_FROM_NUMBER",
    description: "Twilio sender number in E.164 form (+1…). Optional locally — see TWILIO_ACCOUNT_SID.",
    example: "+17325550100",
    schema: z.string().min(1).optional(),
    secret: false,
  },
  {
    key: "UPS_CLIENT_ID",
    description:
      "R-184 DECLARATION ONLY: direct UPS API credentials are declared so ops can provision them, but no code path uses them — all UPS shipping runs through the org's Shippo carrier account (resolution 6).",
    example: "declared-not-implemented",
    schema: z.string().min(1).optional(),
    secret: true,
  },
  {
    key: "UPS_CLIENT_SECRET",
    description:
      "R-184 DECLARATION ONLY: see UPS_CLIENT_ID — declared for provisioning, never read by code.",
    example: "declared-not-implemented",
    schema: z.string().min(1).optional(),
    secret: true,
  },
] as const;

export type EnvKey = (typeof ENV_SPEC)[number]["key"];
