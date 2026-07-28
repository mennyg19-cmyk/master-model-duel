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
    description: "Dev-only login without Clerk (true/false). Must be false in production.",
    example: "false",
    schema: z.enum(["true", "false"]).default("false"),
    secret: false,
  },
] as const;

export type EnvKey = (typeof ENV_SPEC)[number]["key"];
